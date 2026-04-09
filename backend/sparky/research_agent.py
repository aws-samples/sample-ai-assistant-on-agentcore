"""
Research Agent Wrapper for systematic research tasks.

This module provides a wrapper for the Research Agent that is optimized for
thorough, systematic research with enhanced reflection capabilities.

The Research Agent:
- Uses research_prompt() for system prompt with optional skills injection
- Always uses maximum thinking budget (level 3)
- Includes review_progress_tool for research reflection
- Excludes skill management tools (but can use skills for personalized assistance)

"""

import logging
from typing import List, Optional, Any, Dict

from langchain_core.tools import BaseTool
from langchain.agents.middleware.todo import TodoListMiddleware

# Configure logger
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


class ResearchAgentError(Exception):
    """
    Custom exception for Research Agent errors.

    Used to wrap Research Agent-specific errors with context for proper
    error handling and display in the frontend.

    """

    def __init__(
        self,
        message: str,
        original_error: Optional[Exception] = None,
        recoverable: bool = True,
    ):
        """
        Initialize ResearchAgentError.

        Args:
            message: Human-readable error message
            original_error: The original exception that caused this error
            recoverable: Whether the user can retry or switch to Normal Agent
        """
        super().__init__(message)
        self.original_error = original_error
        self.recoverable = recoverable
        self.error_type = "research_agent_error"


# Skill tools to exclude from Research Agent
EXCLUDED_SKILL_TOOLS = {}


def filter_tools_for_research(tools: List[BaseTool]) -> List[BaseTool]:
    """
    Filter tools for Research Agent, excluding skill management tools.

    Args:
        tools: List of all available tools

    Returns:
        Filtered list excluding skill tools

    """
    filtered = [t for t in tools if t.name not in EXCLUDED_SKILL_TOOLS]
    excluded_count = len(tools) - len(filtered)
    if excluded_count > 0:
        logger.debug(f"Excluded {excluded_count} skill tools from Research Agent")
    return filtered


def build_research_tools(base_tools: List[BaseTool]) -> List[BaseTool]:
    """
    Build the tool list for Research Agent.

    Includes:
    - review_progress tool (always included)
    - Web search tools (tavily_search, tavily_extract) if present

    Excludes:
    - Skill management tools (manage_skill)

    Args:
        base_tools: List of all available tools from agent manager

    Returns:
        Filtered and augmented tool list for Research Agent

    """
    from tools import review_progress

    # Start with filtered tools (exclude skill tools)
    filtered_tools = filter_tools_for_research(base_tools)

    # Check if review_progress is already in the list
    tool_names = {t.name for t in filtered_tools}

    # Add review_progress if not already present
    if "review_progress" not in tool_names:
        filtered_tools.append(review_progress)
        logger.debug("Added review_progress tool to Research Agent")

    logger.debug(f"Research Agent tools: {[t.name for t in filtered_tools]}")
    return filtered_tools


class ResearchAgentWrapper:
    """
    Wrapper for Research Agent with reflection capabilities.

    Provides a consistent interface for the Research Agent that matches
    the existing ReactAgent interface used by the streaming handler.

    The Research Agent:
    - Uses research_prompt() for system prompt with optional skills injection
    - Always uses maximum thinking budget (level 3)
    - Includes review_progress_tool for research reflection
    - Excludes skill management tools

    """

    def __init__(
        self,
        model: Any,
        tools: List[BaseTool],
        checkpointer: Optional[Any] = None,
        skills: Optional[List[Dict[str, Any]]] = None,
        public_skills: Optional[List[Dict[str, Any]]] = None,
    ):
        """
        Initialize the Research Agent wrapper.

        Args:
            model: The LLM model instance (must be created with budget_level=3)
            tools: List of tools (should include review_progress, exclude skill tools)
            checkpointer: Session checkpointer for persistence (same as other agents)
            skills: Optional list of user skills for system prompt injection.
                    Each skill is a dict with 'skill_name' and 'description'.
            public_skills: Optional list of public skills for system prompt injection.
        """
        self.model = model
        self.tools = tools
        self.checkpointer = checkpointer
        self.skills = skills
        self.public_skills = public_skills
        self.graph = self._build_agent()

        logger.debug(f"ResearchAgentWrapper initialized with {len(tools)} tools")
        logger.debug(f"Research Agent tools: {[t.name for t in tools]}")
        if skills:
            logger.debug(f"Research Agent initialized with {len(skills)} skills")

    def _build_agent(self) -> Any:
        """
        Build the Research Agent graph.

        Uses the standard ReactAgent graph with:
        - research_prompt() as system prompt with optional skills
        - Filtered tools (no skill tools)
        - Same checkpointer as other agents

        Returns:
            Compiled agent graph
        """
        from graph import create_react_agent
        from prompt import research_prompt

        logger.debug("Building Research Agent graph...")

        # Get research prompt with skills injection
        prompt = research_prompt(skills=self.skills, public_skills=self.public_skills)

        # Create the agent graph using the same pattern as Normal Agent
        from agent_manager import OPTIONAL_TOOL_NAMES

        agent = create_react_agent(
            model=self.model,
            tools=self.tools,
            prompt=prompt,
            checkpointer=self.checkpointer,
            optional_tool_names=OPTIONAL_TOOL_NAMES,
            additional_middleware=[TodoListMiddleware()],
        )

        logger.debug("Research Agent graph built successfully")
        return agent

    async def astream(
        self,
        input_data: Dict[str, Any],
        config: Dict[str, Any],
        stream_mode: List[str] = None,
        version: str = None,
        context=None,
    ):
        """
        Stream responses from the Research Agent.

        Provides the same streaming interface as the Normal_Agent
        to ensure compatibility with the existing streaming handler.

        Args:
            input_data: Input message data (same format as Normal_Agent)
            config: Configuration dict with thread_id and user_id
            stream_mode: List of stream modes (e.g., ["messages", "updates"])
            context: Optional runtime context (e.g. SparkyContext)

        Yields:
            Tuple of (mode, data) for each stream chunk

        Raises:
            ResearchAgentError: If streaming fails
        """
        stream_mode = stream_mode or ["messages", "updates"]

        kwargs = {}
        if context is not None:
            kwargs["context"] = context

        try:
            async for stream_part in self.graph.astream(
                input_data,
                config,
                stream_mode=stream_mode,
                version="v2",
                **kwargs,
            ):
                yield stream_part
        except Exception as e:
            # Log the error with context
            logger.error(f"Research Agent streaming error: {str(e)}")
            logger.error(
                f"Config: thread_id={config.get('configurable', {}).get('thread_id')}"
            )

            # Wrap in ResearchAgentError for consistent error handling
            raise ResearchAgentError(
                message=f"Research Agent encountered an error: {str(e)}",
                original_error=e,
                recoverable=True,
            )

    async def aget_state(self, config: Dict[str, Any]) -> Any:
        """
        Get current state from the Research Agent.

        Used for retrieving conversation history and session state.

        Args:
            config: Configuration dict with thread_id

        Returns:
            Current agent state

        """
        return await self.graph.aget_state(config)

    async def aupdate_state(
        self,
        config: Dict[str, Any],
        values: Dict[str, Any],
    ) -> Any:
        """
        Update the agent state.

        Used for cancellation handling and state management.

        Args:
            config: Configuration dict with thread_id
            values: Values to update in the state

        Returns:
            Updated state
        """
        return await self.graph.aupdate_state(config, values)


def create_research_agent_wrapper(
    model: Any,
    tools: List[BaseTool],
    checkpointer: Optional[Any] = None,
    skills: Optional[List[Dict[str, Any]]] = None,
    public_skills: Optional[List[Dict[str, Any]]] = None,
) -> ResearchAgentWrapper:
    """
    Factory function to create a Research Agent wrapper.

    Provides a consistent interface for creating Research Agent instances.

    Args:
        model: The LLM model instance (should be created with budget_level=3)
        tools: List of tools (will be filtered and augmented for research)
        checkpointer: Session checkpointer for persistence
        skills: Optional list of user skills for system prompt injection.
                Each skill is a dict with 'skill_name' and 'description'.
        public_skills: Optional list of public skills for system prompt injection.

    Returns:
        ResearchAgentWrapper instance

    Raises:
        ResearchAgentError: If creation fails

    """
    try:
        # Build research-specific tool list
        research_tools = build_research_tools(tools)

        return ResearchAgentWrapper(
            model=model,
            tools=research_tools,
            checkpointer=checkpointer,
            skills=skills,
            public_skills=public_skills,
        )
    except Exception as e:
        logger.error(f"Failed to create Research Agent wrapper: {str(e)}")
        raise ResearchAgentError(
            message=f"Failed to initialize Research Agent: {str(e)}",
            original_error=e,
            recoverable=True,
        )
