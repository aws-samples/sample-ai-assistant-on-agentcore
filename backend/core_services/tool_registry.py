"""
Tool Registry Configuration

This module defines the available tools and their configuration requirements.
The registry is used to:
1. Populate default tool states for new users
2. Define which tools require configuration (e.g., API keys)
3. Provide metadata for the tool configuration UI
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class ConfigField:
    """Defines a configuration field for a tool."""

    name: str
    label: str
    type: str  # "string" | "password" | "number"
    required: bool
    default: Optional[str] = None


@dataclass
class ToolDefinition:
    """Defines a tool and its configuration requirements."""

    id: str
    name: str
    description: str
    enabled_by_default: bool
    requires_config: bool
    config_fields: List[ConfigField] = field(default_factory=list)
    tool_type: str = "local"  # "local" | "mcp"


# Tool Registry - defines all available local tools
TOOL_REGISTRY: Dict[str, ToolDefinition] = {
    "tavily": ToolDefinition(
        id="tavily",
        name="Tavily Web Tools",
        description="Web search and content extraction using Tavily API for real-time information",
        enabled_by_default=False,
        requires_config=True,
        config_fields=[
            ConfigField(
                name="api_key",
                label="Tavily API Key",
                type="password",
                required=True,
                default=None,
            )
        ],
        tool_type="local",
    ),
    "create_document": ToolDefinition(
        id="create_document",
        name="Document Canvas",
        description="Create markdown rich-text canvases for articles, reports, proposals, emails, and notes.",
        enabled_by_default=True,
        requires_config=False,
        config_fields=[],
        tool_type="local",
    ),
    "create_html_canvas": ToolDefinition(
        id="create_html_canvas",
        name="HTML Canvas",
        description="Create interactive HTML canvases with inline CSS and JavaScript.",
        enabled_by_default=True,
        requires_config=False,
        config_fields=[],
        tool_type="local",
    ),
    "create_code_canvas": ToolDefinition(
        id="create_code_canvas",
        name="Code Canvas",
        description="Create source code canvases for any programming language.",
        enabled_by_default=True,
        requires_config=False,
        config_fields=[],
        tool_type="local",
    ),
    "create_diagram": ToolDefinition(
        id="create_diagram",
        name="Diagram Canvas",
        description="Create draw.io XML diagram canvases for architecture diagrams.",
        enabled_by_default=True,
        requires_config=False,
        config_fields=[],
        tool_type="local",
    ),
    "create_svg": ToolDefinition(
        id="create_svg",
        name="SVG Canvas",
        description="Create SVG canvases for custom vector graphics.",
        enabled_by_default=True,
        requires_config=False,
        config_fields=[],
        tool_type="local",
    ),
    "create_mermaid": ToolDefinition(
        id="create_mermaid",
        name="Mermaid Canvas",
        description="Create Mermaid diagram canvases for flowcharts, sequence diagrams, and more.",
        enabled_by_default=True,
        requires_config=False,
        config_fields=[],
        tool_type="local",
    ),
}


def get_tool_registry() -> Dict[str, ToolDefinition]:
    """Returns the tool registry dictionary."""
    return TOOL_REGISTRY


def get_tool_definition(tool_id: str) -> Optional[ToolDefinition]:
    """Returns a specific tool definition by ID."""
    return TOOL_REGISTRY.get(tool_id)


def get_default_tool_config() -> Dict[str, dict]:
    """
    Returns the default tool configuration for new users.
    Each tool is set to its default enabled state with empty config.
    """
    default_config = {}
    for tool_id, tool_def in TOOL_REGISTRY.items():
        default_config[tool_id] = {"enabled": tool_def.enabled_by_default, "config": {}}
    return default_config


def validate_tool_config(tool_id: str, config: dict) -> tuple[bool, Optional[str]]:
    """
    Validates that a tool's configuration meets requirements.

    Returns:
        tuple: (is_valid, error_message)
    """
    tool_def = TOOL_REGISTRY.get(tool_id)
    if not tool_def:
        return False, f"Unknown tool: {tool_id}"

    if not tool_def.requires_config:
        return True, None

    # Check required fields
    for config_field in tool_def.config_fields:
        if config_field.required:
            value = config.get(config_field.name)
            if not value or (isinstance(value, str) and not value.strip()):
                return False, f"Required field '{config_field.label}' is missing"

    # Tool-specific validation
    if tool_id == "tavily":
        is_valid, error = validate_tavily_api_key(config.get("api_key", ""))
        if not is_valid:
            return False, error

    return True, None


def validate_tavily_api_key(api_key: str) -> tuple[bool, Optional[str]]:
    """
    Validates a Tavily API key format.

    Tavily API keys are typically prefixed with 'tvly-' and have a specific length.

    Args:
        api_key: The API key to validate

    Returns:
        tuple: (is_valid, error_message)
    """
    if not api_key or not api_key.strip():
        return False, "Tavily API key is required"

    api_key = api_key.strip()

    # Tavily API keys typically start with 'tvly-'
    if not api_key.startswith("tvly-"):
        return False, "Invalid Tavily API key format. Key should start with 'tvly-'"

    # Tavily API keys are typically around 32+ characters
    if len(api_key) < 20:
        return False, "Invalid Tavily API key format. Key appears too short"

    return True, None


def can_enable_tool(tool_id: str, config: dict) -> tuple[bool, Optional[str]]:
    """
    Check if a tool can be enabled based on its configuration requirements.

    This function validates that all required configuration is provided
    before allowing a tool to be enabled.

    Args:
        tool_id: The tool identifier
        config: The tool's configuration dictionary

    Returns:
        tuple: (can_enable, error_message)
    """
    tool_def = TOOL_REGISTRY.get(tool_id)
    if not tool_def:
        return False, f"Unknown tool: {tool_id}"

    # Tools without config requirements can always be enabled
    if not tool_def.requires_config:
        return True, None

    # Validate the configuration
    return validate_tool_config(tool_id, config)


def tool_definition_to_dict(tool_def: ToolDefinition) -> dict:
    """Converts a ToolDefinition to a dictionary for API responses."""
    return {
        "id": tool_def.id,
        "name": tool_def.name,
        "description": tool_def.description,
        "enabled_by_default": tool_def.enabled_by_default,
        "requires_config": tool_def.requires_config,
        "config_fields": [
            {
                "name": config_field.name,
                "label": config_field.label,
                "type": config_field.type,
                "required": config_field.required,
                "default": config_field.default,
            }
            for config_field in tool_def.config_fields
        ],
        "tool_type": tool_def.tool_type,
    }


def get_registry_as_dict() -> Dict[str, dict]:
    """Returns the entire registry as a dictionary for API responses."""
    return {
        tool_id: tool_definition_to_dict(tool_def)
        for tool_id, tool_def in TOOL_REGISTRY.items()
    }
