"""
Sub-agent tool for the Research Agent.

Exposes a `sub_agent` tool that the parent Research Agent can call to delegate
focused research sub-tasks. Each invocation spins up a fresh, stateless agent
(no checkpointer, no shared conversation state). The sub-agent runs on
Claude Sonnet 4.6 at effort "medium" and has access to:

  * Tavily search and extract tools (always available, sharing the parent's
    Tavily client instances).
  * Any extra MCP tools the parent explicitly opts in via `extra_tools`. The
    `extra_tools` argument is typed as a `Literal[...]` of the parent's
    currently-active MCP tool names, so the model literally cannot pass a
    name outside that set.

Only the sub-agent's final assistant text is returned to the parent.
"""

from __future__ import annotations

import logging
from typing import Any, List, Literal, Optional

from langchain.agents import create_agent
from langchain.tools import tool
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import BaseTool
from pydantic import Field, create_model

from config import create_model as create_bedrock_model

logger = logging.getLogger(__name__)


SUB_AGENT_MODEL_ID = "claude-sonnet-4.6"
SUB_AGENT_BUDGET_LEVEL = 2  # effort = medium for Sonnet 4.6


DEFAULT_SUB_AGENT_SYSTEM_PROMPT = """You are a focused research sub-agent invoked by a parent agent to handle a self-contained research sub-task.

You operate stateless: you do not see prior conversation, you do not maintain memory across calls, and you should not ask clarifying questions back to the user. Treat the request you receive as the complete brief.

Use the tools available to you to gather the information needed, then return a clear, well-grounded answer to the parent agent. Cite the sources you actually used. Be concise — the parent will integrate your output into a larger response, so prefer dense, factual prose over headings, bullets, or formatting flourishes. If the request cannot be completed with the tools you have, say so plainly and explain what is missing rather than guessing.
""".strip()


SUB_AGENT_TOOL_DESCRIPTION = """Delegate a focused, self-contained research sub-task to a stateless sub-agent.

Use this when a sub-question can be answered independently and you want isolated context (e.g., to explore one angle in depth without polluting your own context with intermediate search results).

The sub-agent is stateless — it does not see prior conversation and does not persist across calls. It runs on Claude Sonnet 4.6 with medium reasoning. By default it has tavily_search and tavily_extract. You can opt it into additional tools via `extra_tools`, but only tool names that are currently available to you may be passed; unknown names are rejected.

Args:
    system_prompt: Additional system-prompt guidance specific to this sub-task. Concatenated after the sub-agent's built-in default prompt. Use this to focus the sub-agent (e.g., "You are researching FDA Phase III trial outcomes for drug X. Prioritize primary sources.").
    request: The actual task / human request the sub-agent should fulfill. Must be self-contained — include any context, definitions, or constraints the sub-agent needs, since it has no access to the parent conversation.
    extra_tools: Optional list of additional MCP tool names to enable for the sub-agent. Must be a subset of the MCP tools currently available to you. Tavily search/extract are always available and do not need to be listed here.

Returns:
    The sub-agent's final answer as plain text.
"""


def _extract_final_text(message: Any) -> str:
    """Pull plain-text content out of an AIMessage, flattening list-form content."""
    content = getattr(message, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                text = block.get("text", "")
                if text:
                    parts.append(text)
            elif isinstance(block, str):
                parts.append(block)
        return "\n".join(parts).strip()
    return str(content)


def create_sub_agent_tool(
    parent_tools: List[BaseTool],
    mcp_tool_names: List[str],
) -> Optional[BaseTool]:
    """
    Build the `sub_agent` tool bound to a specific parent session.

    The tool's `extra_tools` field is dynamically typed as a `Literal[...]` of
    the names in `mcp_tool_names`, so the parent model can only pass MCP tool
    names that it actually has access to.

    Args:
        parent_tools: The parent agent's full active tool list. Used to
            (a) find the parent's tavily_search / tavily_extract instances
            (so the sub-agent shares the same clients / API key) and
            (b) resolve extra_tools names to live tool objects.
        mcp_tool_names: Names of the parent's currently-active MCP tools.
            Becomes the Literal enum for `extra_tools`. May be empty — in
            that case, `extra_tools` is accepted but always discarded.

    Returns:
        A `BaseTool` named "sub_agent", or `None` if Tavily is not configured
        for the parent (in which case the sub-agent would have nothing useful
        to do by default and is omitted entirely).
    """
    parent_tools_by_name: dict[str, BaseTool] = {t.name: t for t in parent_tools}

    tavily_search = parent_tools_by_name.get("tavily_search")
    tavily_extract = parent_tools_by_name.get("tavily_extract")
    if tavily_search is None and tavily_extract is None:
        logger.debug(
            "Sub-agent tool not built — parent has no Tavily tools configured"
        )
        return None

    default_sub_tools: list[BaseTool] = [
        t for t in (tavily_search, tavily_extract) if t is not None
    ]

    # Restrict extra_tools to the parent's MCP tool names that are actually
    # resolvable as live tool objects.
    valid_mcp_names = [n for n in mcp_tool_names if n in parent_tools_by_name]

    # --- Build a dynamic args_schema so extra_tools is Literal[...] -----
    if valid_mcp_names:
        # tuple of literals — pydantic accepts Literal[*tuple] only via subscript
        extra_tools_type: Any = Optional[List[Literal[tuple(valid_mcp_names)]]]  # type: ignore[valid-type]
        extra_tools_description = (
            "Optional MCP tools to enable for the sub-agent. Allowed values: "
            + ", ".join(valid_mcp_names)
        )
    else:
        extra_tools_type = Optional[List[str]]
        extra_tools_description = (
            "No MCP tools are currently available to enable. Leave unset."
        )

    SubAgentArgs = create_model(
        "SubAgentArgs",
        system_prompt=(
            str,
            Field(
                ...,
                description=(
                    "Additional system-prompt guidance for this sub-task. "
                    "Concatenated after the sub-agent's default prompt."
                ),
            ),
        ),
        request=(
            str,
            Field(
                ...,
                description=(
                    "The self-contained request the sub-agent should fulfill. "
                    "Must include any context the sub-agent needs since it has "
                    "no access to prior conversation."
                ),
            ),
        ),
        extra_tools=(
            extra_tools_type,
            Field(default=None, description=extra_tools_description),
        ),
    )

    @tool(
        "sub_agent",
        description=SUB_AGENT_TOOL_DESCRIPTION,
        args_schema=SubAgentArgs,
    )
    async def sub_agent(
        system_prompt: str,
        request: str,
        extra_tools: Optional[List[str]] = None,
    ) -> str:
        # Resolve extra_tools to live tool objects, silently dropping any that
        # the parent no longer has (the Literal already prevents unknown names
        # at the schema level, but the parent's tool set could change between
        # registration and invocation).
        sub_tools: list[BaseTool] = list(default_sub_tools)
        if extra_tools:
            for name in extra_tools:
                live = parent_tools_by_name.get(name)
                if live is not None and live not in sub_tools:
                    sub_tools.append(live)
                else:
                    logger.warning(
                        "Sub-agent: requested extra tool '%s' is not available — skipping",
                        name,
                    )

        composed_prompt = (
            f"{DEFAULT_SUB_AGENT_SYSTEM_PROMPT}\n\n{system_prompt}".strip()
        )

        try:
            sub_model = create_bedrock_model(
                budget_level=SUB_AGENT_BUDGET_LEVEL,
                model_id=SUB_AGENT_MODEL_ID,
            )
        except Exception as e:
            logger.error("Sub-agent: failed to create model: %s", e)
            return f"Sub-agent failed to start: {e}"

        graph = create_agent(
            sub_model,
            sub_tools,
            system_prompt=SystemMessage(content=composed_prompt),
        )

        try:
            result = await graph.ainvoke(
                {"messages": [HumanMessage(content=request)]}
            )
        except Exception as e:
            logger.error("Sub-agent: invocation failed: %s", e)
            return f"Sub-agent error: {e}"

        messages = result.get("messages", []) if isinstance(result, dict) else []
        if not messages:
            return "Sub-agent returned no output."

        return _extract_final_text(messages[-1]) or "Sub-agent returned no text."

    logger.debug(
        "Sub-agent tool built (default tools: %s, extra MCP allow-list: %s)",
        [t.name for t in default_sub_tools],
        valid_mcp_names,
    )
    return sub_agent
