"""
Core-Services FastAPI Application.

A lightweight synchronous API service handling CRUD operations for:
- Chat history management
- Tool configuration
- MCP server management
- Search functionality
"""

from contextlib import asynccontextmanager
import base64
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from models import InvocationRequest
from handlers import handlers
from utils import logger, CORS_HEADERS, get_user_id_from_token, error_envelope
from exceptions import MissingHeader


# Request types handled by Core-Services (synchronous operations)
CORE_SERVICES_REQUEST_TYPES = {
    "chat_history",
    "rename_chat",
    "generate_description",
    "get_tool_config",
    "save_tool_config",
    "get_tool_registry",
    "add_mcp_server",
    "delete_mcp_server",
    "refresh_mcp_tools",
    "search",
    # Session management
    "get_session",
    "get_session_history",
    # Skills management
    "list_skills",
    "get_skill",
    "get_skill_content",
    "save_skill_content",
    "create_skill",
    "update_skill",
    "delete_skill",
    "list_public_skills",
    "get_public_skill",
    # Template management
    "upload_template",
    "delete_template",
    "delete_script",
    # Reference management
    "upload_reference",
    "delete_reference",
    # Download URL refresh
    "refresh_download_url",
    # Projects management
    "create_project",
    "list_projects",
    "get_project",
    "update_project",
    "delete_project",
    "get_upload_url",
    "confirm_file_upload",
    "list_project_files",
    "delete_project_file",
    "get_file_download_url",
    "bind_project",
    "unbind_project",
    "get_session_project",
    "list_project_sessions",
    "add_artifact_to_project",
    # Project canvas artifacts
    "list_project_canvases",
    "delete_project_canvas",
    # Project memory
    "list_project_memories",
    "delete_project_memory",
    # Cron jobs management
    "create_cron_job",
    "list_cron_jobs",
    "get_cron_job",
    "update_cron_job",
    "delete_cron_job",
    "toggle_cron_job",
    "trigger_cron_job",
    "list_cron_executions",
    "get_cron_execution",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan handler for Core-Services initialization and cleanup.

    Core-Services is stateless and doesn't require complex initialization
    like Sparky's agent manager. Services are initialized on-demand.
    """
    logger.debug("Core-Services starting up...")
    logger.debug(f"Handling request types: {sorted(CORE_SERVICES_REQUEST_TYPES)}")

    try:
        yield
    finally:
        logger.debug("Core-Services shutting down...")


# Initialize FastAPI app
app = FastAPI(
    title="Core-Services API",
    version="1.0.0",
    description="Synchronous API service for chat history, tool configuration, and search",
    lifespan=lifespan,
)

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.exception_handler(MissingHeader)
async def missing_header_handler(request: Request, exc: MissingHeader):
    """Handle missing header exceptions with appropriate error response."""
    return error_envelope("auth_error", exc.detail)


@app.options("/invocations")
async def handle_options():
    """Handle CORS preflight requests."""
    return JSONResponse(
        {"message": "OK"},
        headers=CORS_HEADERS,
    )


@app.post("/invocations")
async def invoke(request: InvocationRequest, http_request: Request):
    """
    Process synchronous API requests and route to appropriate handlers.

    Validates JWT token from Authorization header and routes requests
    based on the 'type' field in the request input.

    """
    # Validate Authorization header
    auth_header = http_request.headers.get("Authorization")
    if not auth_header:
        raise MissingHeader("Missing authorization header")

    # Extract user_id from JWT token
    try:
        user_id = get_user_id_from_token(auth_header)
        if not user_id:
            raise MissingHeader("Invalid token: missing user identifier")
    except ValueError as e:
        raise MissingHeader(f"Invalid token: {str(e)}")

    request_type = request.input.get("type")

    # Route to appropriate handler based on request type

    # Chat History handlers
    if request_type == "chat_history":
        limit = request.input.get("limit", 20)
        cursor = request.input.get("cursor")
        bookmarked = request.input.get("bookmarked")
        return await handlers.handle_chat_history(
            user_id, limit, cursor, bookmarked_filter=bookmarked
        )

    if request_type == "toggle_bookmark":
        session_id = request.input.get("session_id", "")
        return await handlers.handle_toggle_bookmark(
            session_id=session_id, user_id=user_id
        )

    if request_type == "bookmarked_chat_history":
        return await handlers.handle_bookmarked_chat_history(user_id=user_id)

    if request_type == "rename_chat":
        session_id = request.input.get("session_id", "")
        description = request.input.get("description", "")
        return await handlers.handle_rename_chat(
            session_id=session_id, description=description, user_id=user_id
        )

    if request_type == "generate_description":
        session_id = request.input.get("session_id", "")
        message = request.input.get("message", "")
        project_id = request.input.get("project_id") or None
        return await handlers.handle_generate_description(
            session_id=session_id,
            message=message,
            user_id=user_id,
            project_id=project_id,
        )

    if request_type == "get_session":
        session_id = request.input.get("session_id")
        return await handlers.handle_get_session(session_id=session_id, user_id=user_id)

    if request_type == "get_session_history":
        session_id = request.input.get("session_id")
        return await handlers.handle_get_session_history(
            session_id=session_id, user_id=user_id
        )

    # Tool Configuration handlers
    if request_type == "get_tool_config":
        persona = request.input.get("persona", "generic")
        return await handlers.handle_get_tool_config(user_id, persona)

    if request_type == "save_tool_config":
        config = request.input.get("config", {})
        persona = request.input.get("persona", "generic")
        return await handlers.handle_save_tool_config(user_id, config, persona)

    if request_type == "get_tool_registry":
        return await handlers.handle_get_tool_registry()

    # MCP Server handlers
    if request_type == "add_mcp_server":
        server = request.input.get("server", {})
        persona = request.input.get("persona", "generic")
        return await handlers.handle_add_mcp_server(user_id, server, persona)

    if request_type == "delete_mcp_server":
        server_name = request.input.get("server_name", "")
        persona = request.input.get("persona", "generic")
        return await handlers.handle_delete_mcp_server(user_id, server_name, persona)

    if request_type == "refresh_mcp_tools":
        server_name = request.input.get("server_name", "")
        persona = request.input.get("persona", "generic")
        return await handlers.handle_refresh_mcp_tools(user_id, server_name, persona)

    # Search handler
    if request_type == "search":
        query = request.input.get("query", "")
        limit = request.input.get("limit", 10)
        return await handlers.handle_search(query, user_id, limit)

    # Skills Management handlers
    if request_type == "list_skills":
        limit = request.input.get("limit", 50)
        cursor = request.input.get("cursor")
        return await handlers.handle_list_skills(user_id, limit, cursor)

    if request_type == "get_skill":
        skill_name = request.input.get("skill_name", "")
        return await handlers.handle_get_skill(user_id, skill_name)

    if request_type == "get_skill_content":
        skill_name = request.input.get("skill_name", "")
        return await handlers.handle_get_skill_content(user_id, skill_name)

    if request_type == "save_skill_content":
        skill_name = request.input.get("skill_name", "")
        filename = request.input.get("filename", "")
        content = request.input.get("content", "")
        return await handlers.handle_save_skill_content(
            user_id, skill_name, filename, content
        )

    if request_type == "create_skill":
        skill_name = request.input.get("skill_name", "")
        description = request.input.get("description", "")
        instruction = request.input.get("instruction")
        visibility = request.input.get("visibility", "private")
        return await handlers.handle_create_skill(
            user_id, skill_name, description, instruction, visibility
        )

    if request_type == "update_skill":
        skill_name = request.input.get("skill_name", "")
        description = request.input.get("description", "")
        instruction = request.input.get("instruction")
        visibility = request.input.get("visibility")
        return await handlers.handle_update_skill(
            user_id, skill_name, description, instruction, visibility
        )

    if request_type == "delete_skill":
        skill_name = request.input.get("skill_name", "")
        return await handlers.handle_delete_skill(user_id, skill_name)

    if request_type == "toggle_skill":
        skill_name = request.input.get("skill_name", "")
        disabled = request.input.get("disabled", True)
        return await handlers.handle_toggle_skill(user_id, skill_name, disabled)

    if request_type == "list_public_skills":
        limit = request.input.get("limit", 50)
        cursor = request.input.get("cursor")
        return await handlers.handle_list_public_skills(limit, cursor)

    if request_type == "get_public_skill":
        creator_user_id = request.input.get("creator_user_id", "")
        skill_name = request.input.get("skill_name", "")
        return await handlers.handle_get_public_skill(
            user_id, creator_user_id, skill_name
        )

    # Template management
    if request_type == "upload_template":
        skill_name = request.input.get("skill_name", "")
        filename = request.input.get("filename", "")
        content = request.input.get("content", "")
        # Decode base64 content from frontend
        content_bytes = base64.b64decode(content) if content else b""
        return await handlers.handle_upload_template(
            user_id, skill_name, filename, content_bytes
        )

    if request_type == "delete_template":
        skill_name = request.input.get("skill_name", "")
        filename = request.input.get("filename", "")
        return await handlers.handle_delete_template(user_id, skill_name, filename)

    if request_type == "delete_script":
        skill_name = request.input.get("skill_name", "")
        filename = request.input.get("filename", "")
        return await handlers.handle_delete_script(user_id, skill_name, filename)

    if request_type == "upload_reference":
        skill_name = request.input.get("skill_name", "")
        filename = request.input.get("filename", "")
        content = request.input.get("content", "")
        return await handlers.handle_upload_reference(
            user_id, skill_name, filename, content
        )

    if request_type == "delete_reference":
        skill_name = request.input.get("skill_name", "")
        filename = request.input.get("filename", "")
        return await handlers.handle_delete_reference(user_id, skill_name, filename)

    # Download URL refresh
    if request_type == "refresh_download_url":
        s3_key = request.input.get("s3_key", "")
        return await handlers.handle_refresh_download_url(s3_key, user_id)

    # Projects management
    if request_type == "create_project":
        return await handlers.handle_create_project(
            user_id=user_id,
            name=request.input.get("name", ""),
            description=request.input.get("description", ""),
        )

    if request_type == "list_projects":
        return await handlers.handle_list_projects(
            user_id=user_id,
            cursor=request.input.get("cursor"),
        )

    if request_type == "get_project":
        return await handlers.handle_get_project(
            user_id=user_id,
            project_id=request.input.get("project_id", ""),
        )

    if request_type == "update_project":
        return await handlers.handle_update_project(
            user_id=user_id,
            project_id=request.input.get("project_id", ""),
            name=request.input.get("name"),
            description=request.input.get("description"),
        )

    if request_type == "delete_project":
        return await handlers.handle_delete_project(
            user_id=user_id,
            project_id=request.input.get("project_id", ""),
        )

    if request_type == "get_upload_url":
        return await handlers.handle_get_upload_url(
            user_id=user_id,
            project_id=request.input.get("project_id", ""),
            filename=request.input.get("filename", ""),
            content_type=request.input.get("content_type", ""),
            size_bytes=request.input.get("size_bytes", 0),
        )

    if request_type == "confirm_file_upload":
        return await handlers.handle_confirm_file_upload(
            user_id=user_id,
            project_id=request.input.get("project_id", ""),
            file_id=request.input.get("file_id", ""),
        )

    if request_type == "list_project_files":
        return await handlers.handle_list_project_files(
            user_id=user_id,
            project_id=request.input.get("project_id", ""),
            cursor=request.input.get("cursor"),
        )

    if request_type == "delete_project_file":
        return await handlers.handle_delete_project_file(
            user_id=user_id,
            project_id=request.input.get("project_id", ""),
            file_id=request.input.get("file_id", ""),
        )

    if request_type == "get_file_download_url":
        return await handlers.handle_get_file_download_url(
            user_id=user_id,
            project_id=request.input.get("project_id", ""),
            file_id=request.input.get("file_id", ""),
        )

    if request_type == "bind_project":
        return await handlers.handle_bind_project(
            user_id=user_id,
            session_id=request.input.get("session_id", ""),
            project_id=request.input.get("project_id", ""),
        )

    if request_type == "unbind_project":
        return await handlers.handle_unbind_project(
            user_id=user_id,
            session_id=request.input.get("session_id", ""),
        )

    if request_type == "get_session_project":
        return await handlers.handle_get_session_project(
            user_id=user_id,
            session_id=request.input.get("session_id", ""),
        )

    if request_type == "list_project_sessions":
        return await handlers.handle_list_project_sessions(
            user_id=user_id,
            project_id=request.input.get("project_id", ""),
        )

    if request_type == "add_artifact_to_project":
        return await handlers.handle_add_artifact_to_project(
            user_id=user_id,
            project_id=request.input.get("project_id", ""),
            s3_key=request.input.get("s3_key", ""),
            filename=request.input.get("filename", ""),
        )

    if request_type == "list_project_canvases":
        return await handlers.handle_list_project_canvases(
            user_id=user_id,
            project_id=request.input.get("project_id", ""),
        )

    if request_type == "delete_project_canvas":
        return await handlers.handle_delete_project_canvas(
            user_id=user_id,
            project_id=request.input.get("project_id", ""),
            canvas_id=request.input.get("canvas_id", ""),
        )

    if request_type == "list_project_memories":
        return await handlers.handle_list_project_memories(
            user_id=user_id,
            project_id=request.input.get("project_id", ""),
        )

    if request_type == "delete_project_memory":
        return await handlers.handle_delete_project_memory(
            user_id=user_id,
            project_id=request.input.get("project_id", ""),
            memory_record_id=request.input.get("memory_record_id", ""),
        )

    # Cron Jobs handlers
    if request_type == "create_cron_job":
        return await handlers.handle_create_cron_job(
            user_id=user_id,
            name=request.input.get("name", ""),
            prompt=request.input.get("prompt", ""),
            schedule_expression=request.input.get("schedule_expression", ""),
            timezone_str=request.input.get("timezone", "UTC"),
            skills=request.input.get("skills"),
        )

    if request_type == "list_cron_jobs":
        return await handlers.handle_list_cron_jobs(
            user_id=user_id,
            limit=request.input.get("limit", 50),
            cursor=request.input.get("cursor"),
        )

    if request_type == "get_cron_job":
        return await handlers.handle_get_cron_job(
            user_id=user_id,
            job_id=request.input.get("job_id", ""),
        )

    if request_type == "update_cron_job":
        return await handlers.handle_update_cron_job(
            user_id=user_id,
            job_id=request.input.get("job_id", ""),
            name=request.input.get("name"),
            prompt=request.input.get("prompt"),
            schedule_expression=request.input.get("schedule_expression"),
            timezone_str=request.input.get("timezone"),
            skills=request.input.get("skills"),
        )

    if request_type == "delete_cron_job":
        return await handlers.handle_delete_cron_job(
            user_id=user_id,
            job_id=request.input.get("job_id", ""),
        )

    if request_type == "toggle_cron_job":
        return await handlers.handle_toggle_cron_job(
            user_id=user_id,
            job_id=request.input.get("job_id", ""),
            enabled=request.input.get("enabled", True),
        )

    if request_type == "trigger_cron_job":
        return await handlers.handle_trigger_cron_job(
            user_id=user_id,
            job_id=request.input.get("job_id", ""),
        )

    if request_type == "list_cron_executions":
        return await handlers.handle_list_cron_executions(
            user_id=user_id,
            job_id=request.input.get("job_id", ""),
            limit=request.input.get("limit", 20),
            cursor=request.input.get("cursor"),
        )

    if request_type == "get_cron_execution":
        return await handlers.handle_get_cron_execution(
            user_id=user_id,
            job_id=request.input.get("job_id", ""),
            execution_id=request.input.get("execution_id", ""),
        )

    # Unknown request type - return error
    return error_envelope("validation_error", f"Unknown request type: {request_type}")


@app.get("/ping")
async def ping():
    """
    Health check endpoint.

    Returns a simple health status for load balancer and monitoring.

    """
    return JSONResponse(
        {"status": "Healthy"},
        headers=CORS_HEADERS,
    )


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
