from contextlib import asynccontextmanager
import os
from functools import lru_cache
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from models import InvocationRequest
from agent_manager import agent_manager
from handlers import handlers
from streaming import streaming_handler, cancel_stream_async
from exceptions import MissingHeader
from session_validator import validate_session_ownership
from utils import logger, error_envelope
from config import ALL_AVAILABLE_TOOLS
from mcp_lifecycle_manager import mcp_lifecycle_manager
from tools import (
    fetch_skill,
    manage_skill,
    generate_download_link,
    execute_code,
)
from browser import browser_client, BrowserToolError  # noqa: F401
from tools import browse_web
from canvas import ALL_CREATE_TOOLS, update_canvas
from project_kb_tool import search_project_knowledge_base
from project_memory_tool import recall_project_memory
from project_canvas_tool import load_project_canvas
import jwt


@lru_cache(maxsize=128)
def decode_jwt_token(auth_header: str) -> str:
    """
    Decode JWT token and extract user sub claim.
    Cached to avoid repeated decoding of the same token.
    """
    token = (
        auth_header.replace("Bearer ", "")
        if auth_header.startswith("Bearer ")
        else auth_header
    )

    try:
        # Skip signature validation as agent runtime has already validated the token
        claims = jwt.decode(token, options={"verify_signature": False})
        return claims.get("sub")
    except jwt.InvalidTokenError as e:
        logger.error(f"Invalid JWT token: {e}")
        raise MissingHeader


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize MCP connections and local tools at startup
    try:
        # Start MCP lifecycle manager first — establishes live MCP server connections
        try:
            await mcp_lifecycle_manager.startup()
            logger.debug("MCP lifecycle manager started successfully")
        except Exception as e:
            logger.error(f"MCP lifecycle manager startup failed: {e}")
            # App continues with empty Runtime_Tool_Set; local tools still work

        ALL_AVAILABLE_TOOLS.clear()
        ALL_AVAILABLE_TOOLS.extend(
            [
                fetch_skill,
                manage_skill,
                generate_download_link,
                execute_code,
                browse_web,
                *ALL_CREATE_TOOLS,
                update_canvas,
                search_project_knowledge_base,
                recall_project_memory,
                load_project_canvas,
            ]
        )
        await agent_manager.initialize_default_agent()
        _agent_ready.set()
        logger.debug(
            "Agent initialized with local tools (MCP tools available via lifecycle manager)"
        )
    except Exception as e:
        logger.error(f"Failed to initialize default agent: {e}")
        raise

    try:
        yield
    finally:
        try:
            await mcp_lifecycle_manager.shutdown()
            logger.debug("MCP lifecycle manager shut down successfully")
        except Exception as e:
            logger.error(f"MCP lifecycle manager shutdown error: {e}")
        logger.debug("Shutting down...")


# Initialize FastAPI app
app = FastAPI(title="Sparky Agent Server", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET, POST, OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(MissingHeader)
async def missing_header_handler(request: Request, exc: MissingHeader):
    return error_envelope("auth_error", exc.detail)


@app.options("/invocations")
async def handle_options():
    return {"message": "OK"}


@app.post("/invocations")
async def invoke(request: InvocationRequest, http_request: Request):
    """Process user input and return appropriate response type"""

    # Early validation - fail fast before any processing
    session_header = http_request.headers.get(
        "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id"
    )
    if not session_header:
        raise MissingHeader

    if not http_request.headers.get("Authorization"):
        raise MissingHeader

    # Session header IS the Bedrock session ID directly (UUID)
    # No mapping needed - use it as-is for all Bedrock operations
    session_id = session_header

    # Extract user sub from JWT token for multi-tenancy
    auth_header = http_request.headers.get("Authorization")
    user_sub = decode_jwt_token(auth_header)

    # For M2M tokens (e.g. task executor), fall back to user_id from payload
    if not user_sub:
        user_sub = request.input.get("user_id")
    if not user_sub:
        raise MissingHeader

    request_type = request.input.get("type")

    # Session ownership validation — skip for ping and create_session
    if request_type not in (
        "ping",
        "create_session",
        "run_scheduled_task",
        "convert_execution_to_chat",
    ):
        validation = await validate_session_ownership(session_id, user_sub)
        if validation != "authorized":
            return error_envelope("auth_error", "Session not found or access denied")

    if (not request_type) or (request_type == "resume_interrupt"):
        return await streaming_handler.handle_streaming_request(
            request, session_id, user_sub
        )

    # Handle immediate response types with normal returns
    if request_type == "ping":
        return handlers.handle_ping()

    if request_type == "stop":
        return await cancel_stream_async(session_id)

    if request_type == "tools":
        return error_envelope(
            "validation_error",
            "The 'tools' endpoint is deprecated. Use tool configuration instead.",
        )

    if request_type == "delete_history":
        await cancel_stream_async(session_id)
        return await handlers.handle_delete_history(session_id, user_sub)

    if request_type == "create_session":
        return await handlers.handle_create_session(user_sub, session_id)

    if request_type == "run_scheduled_task":
        import asyncio

        # Only the M2M task executor client may invoke scheduled tasks
        m2m_client_id = os.environ.get("TASK_EXECUTOR_CLIENT_ID", "")
        if not m2m_client_id or user_sub != m2m_client_id:
            return error_envelope(
                "auth_error", "Unauthorized: scheduled tasks require M2M credentials"
            )
        job_id = request.input.get("job_id", "")
        execution_id = request.input.get("execution_id", "")
        prompt = request.input.get("prompt", "")
        # M2M token sub is the Cognito client ID, not the actual user.
        # Use the real user_id from the payload for tool config loading.
        task_user_id = request.input.get("user_id") or user_sub
        _active_tasks[execution_id] = True
        asyncio.create_task(
            _run_scheduled_task(
                prompt=prompt,
                session_id=session_id,
                user_id=task_user_id,
                job_id=job_id,
                execution_id=execution_id,
            )
        )
        return JSONResponse(
            {"type": "scheduled_task_accepted", "execution_id": execution_id}
        )

    if request_type == "prepare":
        return await handlers.handle_prepare(request, session_id, user_sub)

    if request_type == "summary":
        return await handlers.handle_summary(request, session_id, user_sub)

    if request_type == "branch":
        return await handlers.handle_branch(request, session_id, user_sub)

    if request_type == "convert_execution_to_chat":
        return await handlers.handle_convert_execution_to_chat(request, user_sub)

    if request_type == "canvas_edit":
        return await handlers.handle_canvas_edit(request.input, user_sub, session_id)

    if request_type == "generate_live_view_url":
        browser_session_id = request.input.get("browser_session_id")
        return await handlers.handle_generate_live_view_url(browser_session_id)

    if request_type == "take_browser_control":
        session_id_param = request.input.get("session_id")
        return await handlers.handle_take_browser_control(session_id_param)

    if request_type == "release_browser_control":
        session_id_param = request.input.get("session_id")
        lock_id_param = request.input.get("lock_id")
        return await handlers.handle_release_browser_control(
            session_id_param, lock_id_param
        )

    if request_type == "stream_resume":
        return await handlers.handle_stream_resume(session_id)

    if request_type == "save_canvas_to_project":
        return await handlers.handle_save_canvas_to_project(
            request.input, user_sub, session_id
        )

    if request_type == "delete_project_canvas":
        return await handlers.handle_delete_project_canvas(
            request.input, user_sub, session_id
        )

    # Return error for unknown request types
    # Note: Synchronous API requests (chat_history, tool_config, search, mcp operations)
    # should be routed to Core-Services instead of Sparky
    return error_envelope("validation_error", f"Unknown request type: {request_type}")


@app.get("/ping")
async def ping():
    if _active_tasks:
        return JSONResponse({"status": "HealthyBusy"})
    return JSONResponse({"status": "Healthy"})


# =========================================================================
# Async scheduled task execution
# =========================================================================
import asyncio as _asyncio

_active_tasks: dict[str, bool] = {}
_agent_ready = _asyncio.Event()  # set once lifespan init completes

# Tools that make no sense for headless scheduled tasks
_TASK_EXCLUDED_TOOLS: set[str] = {
    "manage_skill",
    "browser",
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


_WEB_SEARCH_TOOL_NAMES = {"tavily_search", "tavily-search", "web_search", "webSearch"}


def _extract_web_search_results(messages) -> list[list[str]]:
    """Build webSearchResults (list of URL lists) from ToolMessages in the conversation."""
    import json as _json
    from langchain_core.messages import ToolMessage

    results = []
    for msg in messages:
        if not isinstance(msg, ToolMessage):
            continue
        if msg.name not in _WEB_SEARCH_TOOL_NAMES:
            continue
        raw = msg.content
        urls = []
        try:
            parsed = _json.loads(raw) if isinstance(raw, str) else raw
            items = []
            if isinstance(parsed, list):
                items = parsed
            elif isinstance(parsed, dict):
                items = parsed.get("results", [])
            for item in items:
                url = ""
                if isinstance(item, str):
                    url = item
                elif isinstance(item, dict):
                    url = item.get("url", "") or item.get("link", "")
                if url:
                    urls.append(url)
        except Exception:
            pass
        if urls:
            results.append(urls)
    return results


def _resolve_citations(output: str, messages) -> str:
    """Resolve index-based <cite urls=[X:Y]> to <cite data-urls="..."> using tool results."""
    import re

    web_search_results = _extract_web_search_results(messages)
    if not web_search_results:
        return output

    def _resolve_index(search_idx: int, result_idx: int) -> str | None:
        si = search_idx - 1
        ri = result_idx - 1
        if si < 0 or si >= len(web_search_results):
            return None
        search_urls = web_search_results[si]
        if ri < 0 or ri >= len(search_urls):
            return None
        return search_urls[ri]

    def _replace_index_cite(m):
        urls_content = m.group(1)
        urls = []
        for pair in re.finditer(r"(\d+):(\d+)", urls_content):
            url = _resolve_index(int(pair.group(1)), int(pair.group(2)))
            if url and url not in urls:
                urls.append(url)
        if urls:
            encoded = ",".join(u.replace('"', "&quot;") for u in urls)
            return f'<cite data-urls="{encoded}"></cite>'
        return ""

    # Resolve index-based citations
    output = re.sub(
        r"<cite\s+urls=\[([^\]]*)\]\s*>(?:</cite>)?",
        _replace_index_cite,
        output,
        flags=re.IGNORECASE,
    )

    # Also resolve direct link citations to data-urls format
    def _replace_link_cite(m):
        links_content = m.group(1)
        url_matches = re.findall(r"""["']([^"']+)["']""", links_content)
        if url_matches:
            encoded = ",".join(u.replace('"', "&quot;") for u in url_matches)
            return f'<cite data-urls="{encoded}"></cite>'
        return ""

    output = re.sub(
        r"""<cite\s+links=\[((?:"[^"]*"|'[^']*'|,|\s)*)\]\s*>(?:</cite>)?""",
        _replace_link_cite,
        output,
        flags=re.IGNORECASE,
    )

    return output


async def _run_scheduled_task(
    prompt: str,
    session_id: str,
    user_id: str,
    job_id: str,
    execution_id: str,
):
    """Run an agent task in the background and write results to DynamoDB."""
    import boto3
    from datetime import datetime, timezone

    # Wait for lifespan init (tools + agent) to finish before invoking the agent
    await _agent_ready.wait()

    region = os.environ.get("REGION", "us-east-1")
    table_name = os.environ.get("TASK_EXECUTIONS_TABLE")
    s3_bucket = os.environ.get("S3_BUCKET")
    if not table_name:
        logger.error("TASK_EXECUTIONS_TABLE not configured")
        return

    dynamodb = boto3.resource("dynamodb", region_name=region)
    table = dynamodb.Table(table_name)
    max_dynamo_bytes = 400_000

    try:
        # Load user-specific tool config (includes Tavily, MCP tools, etc.)
        # Scheduled tasks skip the normal create_session/prepare flow,
        # so we must load tools explicitly.
        # Use build_tools_with_reconciliation (same as create_session) to
        # pick up MCP tools + local tools like Tavily.
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

        config = {
            "configurable": {"thread_id": session_id, "actor_id": user_id},
            "recursion_limit": 200,
        }
        content = [{"type": "text", "text": prompt}]

        from langchain_core.messages import AIMessage

        result = await agent.ainvoke(
            {"messages": [{"role": "user", "content": content}]},
            config,
        )

        # Extract the last AI message as the output
        output = ""
        for msg in reversed(result.get("messages", [])):
            if isinstance(msg, AIMessage) and msg.content:
                output = (
                    msg.content if isinstance(msg.content, str) else str(msg.content)
                )
                break

        # Resolve index-based citations to actual URLs before storing
        if output:
            output = _resolve_citations(output, result.get("messages", []))
        now = datetime.now(timezone.utc).isoformat()

        update_expr = "SET #s = :s, finished_at = :f"
        attr_names = {"#s": "status"}
        attr_values = {":s": "completed", ":f": now}

        if output:
            if len(output.encode("utf-8")) > max_dynamo_bytes:
                s3_key = f"task-outputs/{job_id}/{execution_id}.txt"
                s3 = boto3.client("s3", region_name=region)
                s3.put_object(Bucket=s3_bucket, Key=s3_key, Body=output.encode("utf-8"))
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
                    ":s": "failed",
                    ":f": now,
                    ":e": str(e)[:2000],
                },
            )
        except Exception:
            logger.exception("Failed to record task failure")
    finally:
        _active_tasks.pop(execution_id, None)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",  # nosec B104
        port=8080,
        loop="uvloop",
        http="httptools",
        timeout_keep_alive=75,
        access_log=False,
    )
