"""Background scheduled task execution.

Runs agent tasks headlessly and writes results to DynamoDB.
"""

import asyncio
import json
import os
import re

import boto3
from datetime import datetime, timezone
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage

from agent_manager import agent_manager
from utils import logger

_STATUS_COMPLETED = "completed"
_STATUS_FAILED = "failed"

active_tasks: set[str] = set()
agent_ready = asyncio.Event()  # set once lifespan init completes

# Tools that make no sense for headless scheduled tasks.
# Keep in sync with any new canvas/browser/UI tools added in the future.
_TASK_EXCLUDED_TOOLS: set[str] = {
    "manage_skill",
    "create_document",
    "create_html_canvas",
    "create_code_canvas",
    "create_diagram",
    "create_svg",
    "create_mermaid",
    "update_canvas",
    "search_project_knowledge_base",
    "recall_project_memory",
    "load_project_canvas",
}

_SEARCH_TOOL_NAMES = {"tavily_search", "tavily-search", "web_search", "webSearch"}
_MAX_DYNAMO_BYTES = 400_000


def _resolve_citations(output: str, messages) -> str:
    """Resolve <cite urls=[X:Y]> to <cite data-urls="..."> using web search tool results."""
    all_results = []
    for msg in messages:
        if not isinstance(msg, ToolMessage) or msg.name not in _SEARCH_TOOL_NAMES:
            continue
        urls = []
        try:
            parsed = (
                json.loads(msg.content) if isinstance(msg.content, str) else msg.content
            )
            items = parsed if isinstance(parsed, list) else parsed.get("results", [])
            for item in items:
                url = (
                    item
                    if isinstance(item, str)
                    else (item.get("url", "") or item.get("link", ""))
                )
                if url:
                    urls.append(url)
        except Exception:
            pass
        if urls:
            all_results.append(urls)

    if not all_results:
        return output

    def _repl(m):
        urls = []
        for pair in re.finditer(r"(\d+):(\d+)", m.group(1)):
            si, ri = int(pair.group(1)) - 1, int(pair.group(2)) - 1
            if 0 <= si < len(all_results) and 0 <= ri < len(all_results[si]):
                url = all_results[si][ri]
                if url not in urls:
                    urls.append(url)
        if urls:
            return '<cite data-urls="{}"></cite>'.format(
                ",".join(u.replace('"', "&quot;") for u in urls)
            )
        return ""

    output = re.sub(
        r"<cite\s+urls=\[([^\]]*)\]\s*>(?:</cite>)?", _repl, output, flags=re.IGNORECASE
    )

    def _repl_links(m):
        url_matches = re.findall(r"""["']([^"']+)["']""", m.group(1))
        if url_matches:
            return '<cite data-urls="{}"></cite>'.format(
                ",".join(u.replace('"', "&quot;") for u in url_matches)
            )
        return ""

    output = re.sub(
        r"""<cite\s+links=\[((?:"[^"]*"|'[^']*'|,|\s)*)\]\s*>(?:</cite>)?""",
        _repl_links,
        output,
        flags=re.IGNORECASE,
    )
    return output


async def run_scheduled_task(
    prompt: str,
    session_id: str,
    user_id: str,
    job_id: str,
    execution_id: str,
):
    """Run an agent task in the background and write results to DynamoDB."""
    await agent_ready.wait()

    region = os.environ.get("REGION", "us-east-1")
    table_name = os.environ.get("TASK_EXECUTIONS_TABLE")
    s3_bucket = os.environ.get("S3_BUCKET")
    if not table_name:
        logger.error("TASK_EXECUTIONS_TABLE not configured")
        return

    dynamodb = boto3.resource("dynamodb", region_name=region)
    table = dynamodb.Table(table_name)

    try:
        await agent_manager.build_tools_with_reconciliation(user_id)

        # Filter out UI-only tools that don't apply to headless tasks
        agent_manager.cached_tools = [
            t
            for t in agent_manager.cached_tools
            if getattr(t, "name", "") not in _TASK_EXCLUDED_TOOLS
        ]
        agent_manager.cached_agent = None
        agent_manager._normal_cache_key = None

        agent = await agent_manager.get_agent(user_id=user_id)

        task_instruction = (
            "[TASK INSTRUCTION: This is an automated scheduled task. "
            "Respond with the final output only — no preamble, no planning narration, "
            "no phrases like 'Let me' or 'I'll now'. Start directly with the content.]"
        )

        result = await agent.ainvoke(
            {
                "messages": [
                    HumanMessage(content=[{"type": "text", "text": prompt}]),
                    HumanMessage(
                        content=[{"type": "text", "text": task_instruction}],
                        metadata={"sparky:hidden": True},
                    ),
                ]
            },
            {
                "configurable": {"thread_id": session_id, "actor_id": user_id},
                "recursion_limit": 200,
            },
        )

        output = ""
        for msg in reversed(result.get("messages", [])):
            if isinstance(msg, AIMessage) and msg.content:
                if isinstance(msg.content, str):
                    output = msg.content
                elif isinstance(msg.content, list):
                    # Extract only text blocks, skip reasoning_content and tool_use
                    text_parts = [
                        block.get("text", "") if isinstance(block, dict) else str(block)
                        for block in msg.content
                        if isinstance(block, dict) and block.get("type") == "text"
                    ]
                    output = "\n".join(text_parts)
                else:
                    output = str(msg.content)
                if output:
                    break

        if output:
            output = _resolve_citations(output, result.get("messages", []))

        now = datetime.now(timezone.utc).isoformat()
        update_expr = "SET #s = :s, finished_at = :f"
        attr_names = {"#s": "status"}
        attr_values = {":s": _STATUS_COMPLETED, ":f": now}

        if output:
            if len(output.encode("utf-8")) > _MAX_DYNAMO_BYTES:
                s3_key = f"task-outputs/{job_id}/{execution_id}.txt"
                boto3.client("s3", region_name=region).put_object(
                    Bucket=s3_bucket, Key=s3_key, Body=output.encode("utf-8")
                )
                update_expr += ", output_s3_key = :o"
                attr_values[":o"] = s3_key
            else:
                update_expr += ", #o = :o"
                attr_names["#o"] = "output"
                attr_values[":o"] = output

        table.update_item(
            Key={"job_id": job_id, "execution_id": execution_id},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=attr_names,
            ExpressionAttributeValues=attr_values,
        )
        logger.info("Scheduled task %s execution %s completed", job_id, execution_id)

    except Exception as e:
        logger.exception("Scheduled task %s failed", job_id)
        now = datetime.now(timezone.utc).isoformat()
        try:
            table.update_item(
                Key={"job_id": job_id, "execution_id": execution_id},
                UpdateExpression="SET #s = :s, finished_at = :f, error_message = :e",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={
                    ":s": _STATUS_FAILED,
                    ":f": now,
                    ":e": str(e)[:2000],
                },
            )
        except Exception:
            logger.exception("Failed to record task failure for %s", execution_id)
    finally:
        active_tasks.discard(execution_id)
