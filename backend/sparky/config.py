import json
import os
from langgraph_checkpoint_aws import (
    AgentCoreMemoryStore,
    DynamoDBSaver,
)
from hybrid_checkpointer import CachedCheckpointer
from botocore.session import get_session
from botocore.config import Config
import boto3
from typing import Optional, Any, TypedDict


class ModelConfig(TypedDict, total=False):
    """Configuration for a specific model."""

    max_tokens: int
    reasoning_type: str
    budget_mapping: dict[int, int]
    effort_mapping: dict[int, str]
    beta_flags: list[str]


# Environment Configuration
REGION = os.environ.get("REGION", "us-east-1")
PROJECTS_KB_ID = os.environ.get("PROJECTS_KB_ID")
PROJECTS_TABLE = os.environ.get("PROJECTS_TABLE")
PROJECT_MEMORY_ID = os.environ.get("PROJECT_MEMORY_ID")

# AgentCore Memory Configuration
MEMORY_ID = os.environ.get("MEMORY_ID")
if not MEMORY_ID:
    raise ValueError("MEMORY_ID environment variable is required")

# Parse centralized model config from Terraform-injected env var
_raw_config = os.environ.get("SPARKY_MODEL_CONFIG")
if not _raw_config:
    raise ValueError("SPARKY_MODEL_CONFIG environment variable is required")

try:
    _sparky_config = json.loads(_raw_config)
except json.JSONDecodeError as e:
    raise ValueError(f"SPARKY_MODEL_CONFIG contains invalid JSON: {e}")

# Build lookup structures from parsed config
ALLOWED_MODELS: list[str] = [m["model_id"] for m in _sparky_config["models"]]
MODEL_ID_LOOKUP: dict[str, str] = {
    m["id"]: m["model_id"] for m in _sparky_config["models"]
}
DEFAULT_MODEL_ID: str = _sparky_config["default_model_id"]

MODEL_CONFIGS: dict[str, ModelConfig] = {}
for _m in _sparky_config["models"]:
    _entry: ModelConfig = {
        "max_tokens": _m["max_tokens"],
        "reasoning_type": _m["reasoning_type"],
    }
    if _m["reasoning_type"] == "budget":
        _entry["budget_mapping"] = {int(k): v for k, v in _m["budget_mapping"].items()}
    else:
        _entry["effort_mapping"] = {int(k): v for k, v in _m["effort_mapping"].items()}
    if _m.get("beta_flags"):
        _entry["beta_flags"] = _m["beta_flags"]
    MODEL_CONFIGS[_m["model_id"]] = _entry

# Maximum number of image content blocks allowed in conversation history
MAX_CONVERSATION_IMAGES = 20

# Default configuration for unknown models (preserves current behavior)
DEFAULT_MODEL_CONFIG: ModelConfig = {
    "max_tokens": 64000,
    "reasoning_type": "budget",
    "budget_mapping": {1: 16000, 2: 32000, 3: 63999},
}


def resolve_model_id(model_id: str) -> Optional[str]:
    """
    Resolve a model ID (short or full) to the full provider model ID.

    Args:
        model_id: Short ID (e.g. "claude-opus-4.6") or full provider ID

    Returns:
        The full provider model ID, or None if not found
    """
    # Check if it's already a full model ID
    if model_id in ALLOWED_MODELS:
        return model_id
    # Check if it's a short ID
    if model_id in MODEL_ID_LOOKUP:
        return MODEL_ID_LOOKUP[model_id]
    return None


def validate_model_id(model_id: str) -> bool:
    """
    Validate that model_id is in the allowed list (accepts both short and full IDs).

    Args:
        model_id: The model ID string to validate (short or full)

    Returns:
        True if model_id resolves to a known model, False otherwise
    """
    return resolve_model_id(model_id) is not None


def get_model_config(model_id: str) -> ModelConfig:
    """
    Retrieve configuration for a specific model.

    Args:
        model_id: The model identifier string

    Returns:
        ModelConfig dictionary with max_tokens and budget_mapping.
        Returns model-specific config if model_id exists in MODEL_CONFIGS,
        otherwise returns DEFAULT_MODEL_CONFIG.
    """
    return MODEL_CONFIGS.get(model_id, DEFAULT_MODEL_CONFIG)


def create_bedrock_client(
    region: Optional[str] = REGION, config: Optional[Config] = None
) -> boto3.client:
    """
    Create Bedrock client
    """
    config = config or Config(read_timeout=1000)

    # Create session
    session = get_session()

    # Create client using the session
    return session.create_client(
        service_name="bedrock-runtime", region_name=REGION, config=config
    )


# AWS Client
boto_client = create_bedrock_client()


# Checkpointer — DynamoDB with local InMemorySaver cache
CHECKPOINT_TABLE = os.environ.get("CHECKPOINT_TABLE")
if not CHECKPOINT_TABLE:
    raise ValueError("CHECKPOINT_TABLE environment variable is required")

CHECKPOINT_BUCKET = os.environ.get("CHECKPOINT_BUCKET")
CHECKPOINT_BUCKET_ENDPOINT = os.environ.get("CHECKPOINT_BUCKET_ENDPOINT")
EXPIRY_DURATION_DAYS = int(os.environ.get("EXPIRY_DURATION_DAYS", 365))

_dynamo_kwargs: dict = {
    "table_name": CHECKPOINT_TABLE,
    "region_name": REGION,
    "ttl_seconds": EXPIRY_DURATION_DAYS * 86400,
    "enable_checkpoint_compression": True,
}
if CHECKPOINT_BUCKET:
    _s3_config: dict = {"bucket_name": CHECKPOINT_BUCKET}
    if CHECKPOINT_BUCKET_ENDPOINT:
        _s3_config["endpoint_url"] = CHECKPOINT_BUCKET_ENDPOINT
    _dynamo_kwargs["s3_offload_config"] = _s3_config
_primary_checkpointer = DynamoDBSaver(**_dynamo_kwargs)
checkpointer = CachedCheckpointer(primary=_primary_checkpointer)

# Project long-term memory store (optional — only initialised when PROJECT_MEMORY_ID is set)
memory_store = (
    AgentCoreMemoryStore(memory_id=PROJECT_MEMORY_ID, region_name=REGION)
    if PROJECT_MEMORY_ID
    else None
)

# Available Tools
ALL_AVAILABLE_TOOLS = []


def get_max_budget_level(model_id: str) -> int:
    """Get the maximum budget level for a model from config."""
    resolved_id = MODEL_ID_LOOKUP.get(model_id, model_id)
    config = MODEL_CONFIGS.get(resolved_id, DEFAULT_MODEL_CONFIG)
    mapping = config.get("budget_mapping", config.get("effort_mapping", {}))
    return len(mapping) if mapping else 3


def create_model_config(budget_level: int = 1, model_id: Optional[str] = None) -> dict:
    """Create Bedrock model configuration based on budget level and model-specific settings.

    Args:
        budget_level: The thinking budget level (0 = no thinking, 1-4 depending on model)
        model_id: Optional model ID (short or full). Falls back to MODEL_ID env var.
    """
    effective_model_id = model_id or DEFAULT_MODEL_ID

    # Resolve short ID to full model ID if needed
    if effective_model_id in MODEL_ID_LOOKUP:
        effective_model_id = MODEL_ID_LOOKUP[effective_model_id]

    model_config = MODEL_CONFIGS.get(effective_model_id, DEFAULT_MODEL_CONFIG)

    # Clamp budget_level to model's max level
    max_level = get_max_budget_level(effective_model_id)
    if budget_level > max_level:
        budget_level = max_level

    is_adaptive = model_config.get("reasoning_type") == "effort"

    base_config = {
        "max_tokens": model_config["max_tokens"],
        "model_id": effective_model_id,
        "client": boto_client,
    }

    # Bedrock rejects temperature when thinking.type == "adaptive"
    if not is_adaptive:
        base_config["temperature"] = 0 if budget_level == 0 else 1

    if budget_level == 0:
        # Still apply beta flags (e.g. fine-grained-tool-streaming) even without thinking
        beta_flags = model_config.get("beta_flags", [])
        if beta_flags:
            base_config["additional_model_request_fields"] = {
                "anthropic_beta": beta_flags
            }
        return base_config

    if is_adaptive:
        effort = model_config.get("effort_mapping", {}).get(budget_level, "medium")
        fields = {
            "thinking": {"type": "adaptive", "display": "summarized"},
            "output_config": {"effort": effort},
        }
    else:
        budget_tokens = model_config.get("budget_mapping", {}).get(budget_level, 8000)
        fields = {
            "thinking": {"type": "enabled", "budget_tokens": budget_tokens},
        }

    beta_flags = model_config.get("beta_flags", [])
    if beta_flags:
        fields["anthropic_beta"] = beta_flags

    base_config["additional_model_request_fields"] = fields

    return base_config


def create_model(budget_level: int = 1, model_id: Optional[str] = None) -> Any:
    """Create Bedrock model instance

    Args:
        budget_level: The thinking budget level (0-3)
        model_id: Optional model ID to use. Falls back to MODEL_ID env var if not provided.
    """
    from langchain_aws import ChatBedrockConverse

    config = create_model_config(budget_level, model_id)
    return ChatBedrockConverse(**config)
