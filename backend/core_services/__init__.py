# Core-Services package
# Handles synchronous API operations for chat history, tool configuration, and search

from .config import (
    CHAT_HISTORY_TABLE,
    TOOL_CONFIG_TABLE,
    KB_ID,
    RERANK_MODEL_ARN,
    REGION,
    MODEL_ID,
)

from .utils import (
    logger,
    CORS_HEADERS,
    decode_jwt_token,
    get_user_id_from_token,
)

from .exceptions import MissingHeader

from .models import InvocationRequest

from .chat_history_service import (
    ChatHistoryService,
    chat_history_service,
)

from .tool_registry import (
    ToolDefinition,
    ConfigField,
    get_tool_registry,
    get_tool_definition,
    get_default_tool_config,
    get_registry_as_dict,
    can_enable_tool,
)

from .tool_config_service import (
    ToolConfigService,
    tool_config_service,
)

from .kb_search_service import (
    KBSearchService,
    SearchResult,
    get_kb_search_service,
)

from .kb_event_publisher import (
    KBEventPublisher,
    extract_text_content,
    get_kb_event_publisher,
)

from .handlers import (
    RequestHandlers,
    handlers,
    generate_description_with_llm,
)

__all__ = [
    # Config
    "CHAT_HISTORY_TABLE",
    "TOOL_CONFIG_TABLE",
    "KB_ID",
    "RERANK_MODEL_ARN",
    "REGION",
    "MODEL_ID",
    # Utils
    "logger",
    "CORS_HEADERS",
    "decode_jwt_token",
    "get_user_id_from_token",
    # Exceptions
    "MissingHeader",
    # Models
    "InvocationRequest",
    # Chat History
    "ChatHistoryService",
    "chat_history_service",
    # Tool Registry
    "ToolDefinition",
    "ConfigField",
    "get_tool_registry",
    "get_tool_definition",
    "get_default_tool_config",
    "get_registry_as_dict",
    "can_enable_tool",
    # Tool Config Service
    "ToolConfigService",
    "tool_config_service",
    # KB Search
    "KBSearchService",
    "SearchResult",
    "get_kb_search_service",
    # KB Event Publisher
    "KBEventPublisher",
    "extract_text_content",
    "get_kb_event_publisher",
    # Handlers
    "RequestHandlers",
    "handlers",
    "generate_description_with_llm",
]
