from typing import Optional, List, Dict, Any, Literal
from config import (
    ALL_AVAILABLE_TOOLS,
    checkpointer,
    boto_client,
    create_model,
    DEFAULT_MODEL_ID,
    get_max_budget_level,
)
from utils import get_or_create_agent, logger
from tools import (
    create_tavily_search_tool,
    create_tavily_extract_tool,
    fetch_skill,
    manage_skill,
    generate_download_link,
    execute_code,
    retrieve_images,
    browse_web,
)
from canvas import ALL_CREATE_TOOLS, update_canvas
from project_kb_tool import search_project_knowledge_base
from project_data_tool import load_project_file
from project_memory_tool import recall_project_memory
from project_canvas_tool import load_project_canvas


# Default persona for tool configuration
DEFAULT_PERSONA = "generic"

# Skill tools are always available (not configurable via tool config)
SKILL_TOOLS = [fetch_skill, manage_skill]

# Core tools that are always available (not configurable via tool config)
CORE_TOOLS = [
    generate_download_link,
    execute_code,
    retrieve_images,
    browse_web,
    *ALL_CREATE_TOOLS,
    update_canvas,
    search_project_knowledge_base,
    load_project_file,
    recall_project_memory,
    load_project_canvas,
]

# Optional tools — always registered but only active when user enables them
OPTIONAL_TOOL_NAMES = [
    "browser",
    *[t.name for t in ALL_CREATE_TOOLS],
    "update_canvas",
    "search_project_knowledge_base",
    "load_project_file",
    "recall_project_memory",
    "load_project_canvas",
]


class AgentManager:
    def __init__(self):
        # Normal agent cache
        self._normal_cache_key = None  # (model_id, budget_level, tools_hash)
        self.cached_agent = None
        self.cached_llm = None

        # Research agent cache
        self._research_cache_key = None  # (model_id, tools_hash)
        self.cached_research_agent = None
        self.cached_research_llm = None

        # Shared state
        self.cached_tools = (
            None  # Built tool instances — persists across agent recreations
        )
        self.cached_skills = None  # User skills for system prompt injection
        self.cached_public_skills = None  # Public skills for system prompt injection
        self.current_budget_level = 0
        self.current_user_id = None
        self.cached_optional_tool_prefs: dict[str, bool] = {}  # tool_id → enabled

    async def get_agent(
        self,
        budget_level: int = 0,
        model_id: Optional[str] = None,
        skills: Optional[List[Dict[str, Any]]] = None,
        agent_mode: Literal["normal", "research"] = "normal",
        user_id: Optional[str] = None,
    ):
        """
        Get the appropriate agent based on mode, recreating if model/budget changed.
        Uses cached_tools - does NOT reload tools from DynamoDB.
        Tools are only reloaded via load_and_build_tools().

        Args:
            budget_level: The thinking budget level (0 = no thinking)
            model_id: Optional model ID override
            skills: Optional list of user skills for system prompt injection
            agent_mode: Agent mode - "normal" for React agent, "research" for Research Agent
            user_id: User ID for fetching skills

        Returns:
            The appropriate agent instance based on agent_mode
        """
        if agent_mode == "research":
            return await self._get_research_agent(model_id, user_id)
        else:
            return await self._get_normal_agent(budget_level, model_id, skills)

    async def _get_normal_agent(
        self,
        budget_level: int = 0,
        model_id: Optional[str] = None,
        skills: Optional[List[Dict[str, Any]]] = None,
    ):
        """
        Get the normal React agent, recreating only when the cache key changes.

        Cache key: (model_id, budget_level, tools_hash)
        """
        from utils import get_tools_hash

        effective_model_id = model_id or DEFAULT_MODEL_ID
        effective_skills = skills if skills is not None else self.cached_skills

        available_tools = list(
            self.cached_tools if self.cached_tools is not None else ALL_AVAILABLE_TOOLS
        )
        tools_hash = get_tools_hash(available_tools)

        new_key = (effective_model_id, budget_level, tools_hash)

        if new_key != self._normal_cache_key or self.cached_agent is None:
            logger.debug(
                f"Normal agent cache miss: key={new_key}, prev={self._normal_cache_key}"
            )
            self.cached_llm = create_model(budget_level, effective_model_id)
            self.current_budget_level = budget_level

            result = await get_or_create_agent(
                available_tools,
                self.cached_llm,
                checkpointer,
                boto_client,
                logger,
                None,  # force recreation
                None,  # force recreation
                effective_skills,
                self.cached_public_skills,
                optional_tool_names=OPTIONAL_TOOL_NAMES,
            )
            self.cached_agent, _ = result
            self._normal_cache_key = new_key

        return self.cached_agent

    async def _get_research_agent(
        self,
        model_id: Optional[str] = None,
        user_id: Optional[str] = None,
    ):
        """
        Get the Research Agent, recreating only when the cache key changes.

        Cache key: (model_id, tools_hash)
        Research Agent always uses maximum thinking budget.
        """
        from research_agent import create_research_agent_wrapper, ResearchAgentError
        from utils import get_tools_hash

        effective_model_id = model_id or DEFAULT_MODEL_ID

        if user_id:
            self.current_user_id = user_id

        available_tools = (
            self.cached_tools if self.cached_tools is not None else ALL_AVAILABLE_TOOLS
        )
        tools_hash = get_tools_hash(available_tools)

        new_key = (effective_model_id, tools_hash)

        if new_key != self._research_cache_key or self.cached_research_agent is None:
            logger.debug(
                f"Research agent cache miss: key={new_key}, prev={self._research_cache_key}"
            )

            # Always max budget for research agent
            max_budget = get_max_budget_level(effective_model_id)
            self.cached_research_llm = create_model(max_budget, effective_model_id)

            try:
                self.cached_research_agent = create_research_agent_wrapper(
                    model=self.cached_research_llm,
                    tools=available_tools,
                    checkpointer=checkpointer,
                    skills=self.cached_skills,
                    public_skills=self.cached_public_skills,
                )
                self._research_cache_key = new_key
                logger.debug("Research Agent successfully created")

            except (ImportError, ResearchAgentError, Exception) as e:
                logger.error(f"Failed to create Research Agent: {e}")
                logger.warning("Falling back to Normal Agent with max budget")
                fallback_budget = get_max_budget_level(effective_model_id)
                return await self._get_normal_agent(
                    budget_level=fallback_budget, model_id=model_id
                )

        return self.cached_research_agent

    async def load_and_build_tools(
        self, user_id: str, persona: str = DEFAULT_PERSONA
    ) -> List:
        """
        Load tool config from DynamoDB and build tool instances.
        Also loads user skills for system prompt injection.
        Called on: create_session, prepare with refresh_tools=true.

        Tools are built from cached definitions - NO MCP server connections.
        This invalidates cached_agent since tools changed.

        """
        import asyncio

        # Use default "unknown" user if user_id not available
        effective_user_id = user_id or "unknown"
        if not user_id:
            logger.warning(
                "User context not available, using default 'unknown' user for tool loading"
            )

        logger.debug(f"Loading and building tools for user: {effective_user_id}")
        self.current_user_id = effective_user_id

        try:
            from tool_config_service import tool_config_service
            from skills_service import skills_service

            # Parallelize ALL DynamoDB calls — config, skills, public skills, and disabled skills
            config, skills, public_skills, disabled_skills = await asyncio.gather(
                tool_config_service.get_config(effective_user_id, persona),
                skills_service.list_skills(effective_user_id),
                skills_service.list_public_skills(),
                skills_service.get_disabled_skills(effective_user_id),
                return_exceptions=True,
            )

            # Handle config result
            if isinstance(config, Exception):
                logger.error(f"Failed to fetch tool config: {config}")
                config = None
            if not config:
                config = await tool_config_service.initialize_user_config(
                    effective_user_id, persona
                )

            # Handle skills result
            if isinstance(skills, Exception):
                logger.warning(f"Failed to fetch skills: {skills}")
                self.cached_skills = None
            else:
                self.cached_skills = skills if skills else None

            # Handle public skills result
            if isinstance(public_skills, Exception):
                logger.warning(f"Failed to fetch public skills: {public_skills}")
                self.cached_public_skills = None
            else:
                self.cached_public_skills = public_skills if public_skills else None

            # Filter out disabled skills from both user and public skills
            if isinstance(disabled_skills, Exception):
                logger.warning(
                    f"Failed to get disabled skills for user {effective_user_id}, proceeding with all skills: {disabled_skills}"
                )
                disabled_skills = None
            if disabled_skills:
                if self.cached_skills:
                    self.cached_skills = [
                        s
                        for s in self.cached_skills
                        if s.get("skill_name") not in disabled_skills
                    ]
                if self.cached_public_skills:
                    self.cached_public_skills = [
                        s
                        for s in self.cached_public_skills
                        if s.get("skill_name") not in disabled_skills
                    ]
                logger.debug(
                    f"Filtered disabled skills ({len(disabled_skills)}) for user {effective_user_id}"
                )

            if self.cached_skills:
                logger.debug(
                    f"Loaded {len(self.cached_skills)} skills for user {effective_user_id}"
                )
            if self.cached_public_skills:
                logger.debug(f"Loaded {len(self.cached_public_skills)} public skills")

            # Merge registry tools
            config = merge_registry_into_config(config)

            # Cache optional tool preferences for the prepare response
            self._cache_optional_tool_prefs(config)

            # Build tools from config (no server connections)
            self.cached_tools = self._build_tools_from_config(config)

            self.cached_agent = None  # Force agent recreation with new tools
            self.cached_research_agent = None  # Force Research Agent recreation
            self._normal_cache_key = None
            self._research_cache_key = None

            logger.debug(
                f"Built {len(self.cached_tools)} tools for user {effective_user_id} (from cache)"
            )
            return self.cached_tools

        except Exception as e:
            logger.error(f"Failed to load tools for user {effective_user_id}: {e}")
            # Fall back to default tools
            self.cached_tools = list(ALL_AVAILABLE_TOOLS)
            self.cached_skills = None  # Clear skills on error
            self.cached_public_skills = None  # Clear public skills on error
            self.cached_agent = None
            self.cached_research_agent = None
            self._normal_cache_key = None
            self._research_cache_key = None
            return self.cached_tools

    async def build_tools_with_reconciliation(
        self, user_id: str, persona: str = DEFAULT_PERSONA
    ) -> List:
        """
        Build tools using MCP lifecycle reconciliation instead of cached MCP tool definitions.

        Fetches user preferences from DynamoDB, reconciles MCP tools against the
        Runtime_Tool_Set via MCPLifecycleManager, and combines with local tools.
        Falls back to default config (all tools enabled) if DynamoDB read fails.

        This replaces load_and_build_tools for session init flows.

        """
        import asyncio
        from mcp_lifecycle_manager import mcp_lifecycle_manager

        effective_user_id = user_id or "unknown"
        if not user_id:
            logger.warning(
                "User context not available, using default 'unknown' user for tool loading"
            )

        logger.debug(
            f"Building tools with reconciliation for user: {effective_user_id}"
        )
        self.current_user_id = effective_user_id

        try:
            from tool_config_service import tool_config_service
            from skills_service import skills_service

            # Parallelize ALL DynamoDB calls — config, skills, public skills, and disabled skills
            config, skills, public_skills, disabled_skills = await asyncio.gather(
                tool_config_service.get_config(effective_user_id, persona),
                skills_service.list_skills(effective_user_id),
                skills_service.list_public_skills(),
                skills_service.get_disabled_skills(effective_user_id),
                return_exceptions=True,
            )

            # Handle config result — fall back to default on failure (Req 4.1)
            if isinstance(config, Exception):
                logger.error(f"Failed to fetch tool config from DynamoDB: {config}")
                config = None
            if not config:
                config = await tool_config_service.initialize_user_config(
                    effective_user_id, persona
                )

            # Handle skills result
            if isinstance(skills, Exception):
                logger.warning(f"Failed to fetch skills: {skills}")
                self.cached_skills = None
            else:
                self.cached_skills = skills if skills else None

            # Handle public skills result
            if isinstance(public_skills, Exception):
                logger.warning(f"Failed to fetch public skills: {public_skills}")
                self.cached_public_skills = None
            else:
                self.cached_public_skills = public_skills if public_skills else None

            # Filter out disabled skills from both user and public skills
            if isinstance(disabled_skills, Exception):
                logger.warning(
                    f"Failed to get disabled skills for user {effective_user_id}, proceeding with all skills: {disabled_skills}"
                )
                disabled_skills = None
            if disabled_skills:
                if self.cached_skills:
                    self.cached_skills = [
                        s
                        for s in self.cached_skills
                        if s.get("skill_name") not in disabled_skills
                    ]
                if self.cached_public_skills:
                    self.cached_public_skills = [
                        s
                        for s in self.cached_public_skills
                        if s.get("skill_name") not in disabled_skills
                    ]
                logger.debug(
                    f"Filtered disabled skills ({len(disabled_skills)}) for user {effective_user_id}"
                )

            # Merge registry tools into config
            config = merge_registry_into_config(config)

            # Cache optional tool preferences for the prepare response
            self._cache_optional_tool_prefs(config)

            # --- Build local tools from config (same as _build_tools_from_config minus MCP) ---
            enabled_tools: List = []
            enabled_tools.extend(SKILL_TOOLS)
            enabled_tools.extend(CORE_TOOLS)

            local_tools = config.get("local_tools", {})
            for tool_id, settings in local_tools.items():
                if not settings.get("enabled", False):
                    continue
                try:
                    tool_config = settings.get("config", {})
                    tool_result = self._create_tool_instance(tool_id, tool_config)
                    if tool_result:
                        if isinstance(tool_result, list):
                            enabled_tools.extend(tool_result)
                        else:
                            enabled_tools.append(tool_result)
                except Exception as e:
                    logger.error(f"Failed to create local tool {tool_id}: {e}")

            # --- Reconcile MCP tools via lifecycle manager (Req 4.2, 4.6) ---
            try:
                runtime_tools = mcp_lifecycle_manager.get_runtime_tool_set()
                mcp_tools = await mcp_lifecycle_manager.reconcile(config, runtime_tools)
                enabled_tools.extend(mcp_tools)
                logger.debug(
                    f"Reconciliation added {len(mcp_tools)} MCP tools to Active_Tool_Set"
                )
            except Exception as e:
                logger.error(f"MCP reconciliation failed: {e}")
                # Continue without MCP tools — local tools still work

            # Cache the Active_Tool_Set for the session (Req 4.7)
            self.cached_tools = enabled_tools
            self.cached_agent = None
            self.cached_research_agent = None
            self._normal_cache_key = None
            self._research_cache_key = None

            logger.debug(
                f"Built {len(self.cached_tools)} tools via reconciliation for user {effective_user_id}"
            )
            return self.cached_tools

        except Exception as e:
            logger.error(f"Failed to build tools for user {effective_user_id}: {e}")
            self.cached_tools = list(ALL_AVAILABLE_TOOLS)
            self.cached_skills = None
            self.cached_public_skills = None
            self.cached_agent = None
            self.cached_research_agent = None
            self._normal_cache_key = None
            self._research_cache_key = None
            return self.cached_tools

    async def _load_user_skills(self, user_id: str) -> None:
        """
        Load user skills from DynamoDB for system prompt injection.

        Fetches all skills for the user, filters out disabled skills,
        and caches them for use when building the system prompt.
        Handles errors gracefully to avoid blocking the main flow.

        Args:
            user_id: The authenticated user ID

        """
        # Use default "unknown" user if user_id not available
        effective_user_id = user_id or "unknown"
        if not user_id:
            logger.warning(
                "User context not available, using default 'unknown' user for skills loading"
            )

        try:
            from skills_service import skills_service

            skills = await skills_service.list_skills(effective_user_id)

            # Filter out disabled skills (graceful degradation on failure)
            if skills:
                try:
                    disabled_skills = await skills_service.get_disabled_skills(
                        effective_user_id
                    )
                    if disabled_skills:
                        skills = [
                            s
                            for s in skills
                            if s.get("skill_name") not in disabled_skills
                        ]
                        logger.debug(
                            f"Filtered out {len(disabled_skills)} disabled skills for user {effective_user_id}"
                        )
                except Exception as e:
                    logger.warning(
                        f"Failed to get disabled skills for user {effective_user_id}, proceeding with all skills: {e}"
                    )

            self.cached_skills = skills if skills else None

            if skills:
                logger.debug(
                    f"Loaded {len(skills)} skills for user {effective_user_id}"
                )
            else:
                logger.debug(f"No skills found for user {effective_user_id}")

        except Exception as e:
            # Graceful degradation - continue without skills
            logger.warning(f"Failed to load skills for user {user_id}: {e}")
            self.cached_skills = None

    def _build_tools_from_config(self, config: Dict[str, Any]) -> List:
        """Build tool instances from DynamoDB config, using MCPLifecycleManager for MCP tools."""
        enabled_tools = []
        local_tools = config.get("local_tools", {})

        # Always include skill tools - they are core functionality
        # and not configurable via tool config
        enabled_tools.extend(SKILL_TOOLS)
        logger.debug(f"Added {len(SKILL_TOOLS)} skill tools (always enabled)")

        # Always include core tools - they are essential functionality
        # and not configurable via tool config
        enabled_tools.extend(CORE_TOOLS)
        logger.debug(f"Added {len(CORE_TOOLS)} core tools (always enabled)")

        # Build local tools
        for tool_id, settings in local_tools.items():
            if not settings.get("enabled", False):
                continue
            try:
                tool_config = settings.get("config", {})
                logger.debug(f"Creating tool {tool_id} with config: {tool_config}")
                tool_result = self._create_tool_instance(tool_id, tool_config)
                if tool_result:
                    # Handle both single tools and lists of tools (e.g., tavily returns both search and extract)
                    if isinstance(tool_result, list):
                        enabled_tools.extend(tool_result)
                        logger.debug(
                            f"Enabled {len(tool_result)} tools from: {tool_id}"
                        )
                    else:
                        enabled_tools.append(tool_result)
                        logger.debug(f"Enabled local tool: {tool_id}")
            except Exception as e:
                logger.error(f"Failed to create local tool {tool_id}: {e}")

        # MCP tools are now provided by MCPLifecycleManager via reconcile().
        # This method only builds local tools; MCP tools are added by
        # build_tools_with_reconciliation() during session init (Req 8.3, 8.4).
        logger.debug(
            f"Built {len(enabled_tools)} local tools (MCP tools provided by MCPLifecycleManager)"
        )

        return enabled_tools

    def _create_tool_instance(self, tool_id: str, config: Dict[str, Any]):
        """Create a tool instance."""
        try:
            if tool_id == "tavily":
                # Return both search and extract tools as a list
                api_key = config.get("api_key")
                if api_key:
                    tools = []
                    try:
                        tools.append(create_tavily_search_tool(api_key))
                    except Exception as e:
                        logger.error(f"Failed to create Tavily search tool: {e}")
                    try:
                        tools.append(create_tavily_extract_tool(api_key))
                    except Exception as e:
                        logger.error(f"Failed to create Tavily extract tool: {e}")
                    return tools if tools else None
                logger.warning("Tavily skipped - no API key configured")
                return None
            else:
                logger.warning(f"Unknown tool: {tool_id}")
                return None
        except Exception as e:
            logger.error(f"Failed to create tool {tool_id}: {e}")
            return None

    def _cache_optional_tool_prefs(self, config: Dict[str, Any]) -> None:
        """Extract enabled state for optional tools from DynamoDB config.

        Stores a dict of {tool_id: enabled} for tools in OPTIONAL_TOOL_NAMES,
        so the prepare response can include this info without a separate call.
        """
        local_tools = config.get("local_tools", {})
        self.cached_optional_tool_prefs = {
            name: local_tools.get(name, {}).get("enabled", True)
            for name in OPTIONAL_TOOL_NAMES
        }

    async def initialize_default_agent(self):
        """Initialize with default tools on startup."""
        self.cached_tools = list(ALL_AVAILABLE_TOOLS)
        await self.get_agent(budget_level=1)
        logger.debug(
            f"Initialized with default tools: {[t.name for t in self.cached_tools]}"
        )


def merge_registry_into_config(config: Dict[str, Any]) -> Dict[str, Any]:
    """Merge new registry tools into user config."""
    from tool_registry import get_tool_registry

    registry = get_tool_registry()
    local_tools = config.get("local_tools", {})

    for tool_id, tool_def in registry.items():
        if tool_id not in local_tools:
            local_tools[tool_id] = {
                "enabled": tool_def.enabled_by_default,
                "config": {},
            }

    config["local_tools"] = local_tools
    return config


# Global instance
agent_manager = AgentManager()
