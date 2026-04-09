from contextlib import asynccontextmanager
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

    request_type = request.input.get("type")

    # Session ownership validation — skip for ping and create_session
    if request_type not in ("ping", "create_session"):
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

    if request_type == "prepare":
        return await handlers.handle_prepare(request, session_id, user_sub)

    if request_type == "summary":
        return await handlers.handle_summary(request, session_id, user_sub)

    if request_type == "branch":
        return await handlers.handle_branch(request, session_id, user_sub)

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
    return JSONResponse({"status": "Healthy"})


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
