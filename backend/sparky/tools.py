from langchain.tools import tool
from langchain_core.tools import ToolException
from langchain_core.runnables import RunnableConfig
from langgraph.config import get_stream_writer
from langchain_tavily import TavilySearch, TavilyExtract
from typing import Literal
from utils import logger
from skills_service import skills_service, strip_frontmatter
from code_interpreter import code_interpreter_client, CodeInterpreterError
from browser import browser_client, BrowserToolError
import asyncio
import boto3

# Module-level S3 client — region resolved after code_interpreter_client is imported
s3_client = boto3.client("s3", region_name=code_interpreter_client.region)
import base64
import io
import json
import mimetypes
import os


def _get_user_id_from_config(config: RunnableConfig) -> str:
    """
    Extract user_id from RunnableConfig.

    Args:
        config: The RunnableConfig passed to the tool at runtime

    Returns:
        The user_id from config, or "unknown" if not available
    """
    if config:
        configurable = config.get("configurable", {})
        user_id = configurable.get("user_id")
        if user_id:
            return user_id
        # Also try actor_id as fallback (used in some contexts)
        actor_id = configurable.get("actor_id")
        if actor_id:
            return actor_id
    logger.warning("User context not available in config, using default 'unknown' user")
    return "unknown"


def create_tavily_search_tool(api_key: str) -> TavilySearch:
    """
    Create a Tavily search tool configured with the user's API key.

    Args:
        api_key: The user's Tavily API key

    Returns:
        TavilySearch tool instance configured with max_results=5 and topic="general"

    Raises:
        ValueError: If api_key is empty or None
    """
    if not api_key or not api_key.strip():
        raise ToolException("Tavily API key is required")

    return TavilySearch(tavily_api_key=api_key, max_results=5, topic="general")


def create_tavily_extract_tool(api_key: str) -> TavilyExtract:
    """
    Create a Tavily extract tool configured with the user's API key.

    Args:
        api_key: The user's Tavily API key

    Returns:
        TavilyExtract tool instance configured with extract_depth="basic"

    Raises:
        ValueError: If api_key is empty or None
    """
    if not api_key or not api_key.strip():
        raise ToolException("Tavily API key is required")

    return TavilyExtract(tavily_api_key=api_key, extract_depth="basic")


@tool(
    name_or_callable="fetch_skill",
    description="""Fetch the instruction for a skill by name.

Use this tool when you need to retrieve the detailed instructions for a skill
that is listed in your available_skills section. If the skill has scripts or
templates, they will be loaded into the Code Interpreter automatically.

Args:
    skill_name: The name of the skill to fetch (from available_skills list)

Returns:
    The skill instruction text if found, or an error message if not found.
    If scripts/templates exist, includes the Code Interpreter path where files are loaded.

Example:
    fetch_skill(skill_name="code_review_checklist")
""",
)
async def fetch_skill(skill_name: str, config: RunnableConfig) -> str:
    """
    Fetch the instruction for a skill by name.

    Checks if the skill is disabled first. Then checks system skills,
    user's own skills, then public skills.
    Fetches content from S3 and loads scripts/templates into Code Interpreter.

    Args:
        skill_name: The name of the skill to fetch
        config: RunnableConfig injected at runtime (hidden from LLM)

    Returns:
        The skill instruction text (with CI path if scripts/templates exist),
        or error message if not found or disabled

    """
    # Extract user_id from runtime config
    user_id = _get_user_id_from_config(config)

    # Normalize skill_name to match how it's stored
    skill_name = skill_name.strip() if skill_name else skill_name

    try:
        # Check if skill is disabled for this user
        try:
            disabled_skills = await skills_service.get_disabled_skills(user_id)
            if skill_name in disabled_skills:
                return f"Skill '{skill_name}' is disabled. Enable it in the Skills page to use it."
        except Exception as e:
            logger.warning(f"Failed to check disabled skills for user {user_id}: {e}")

        # Check system skills first
        system_skill = await skills_service.get_system_skill(skill_name)
        if system_skill:
            logger.debug(f"Fetched system skill '{skill_name}' for user: {user_id}")
            return await _build_fetch_response(skill_name, "system", config)

        # Check user's own skills
        skill = await skills_service.get_skill(user_id, skill_name)
        if skill:
            logger.debug(f"Fetched skill '{skill_name}' for user: {user_id}")
            return await _build_fetch_response(skill_name, user_id, config)

        # Fall back to public skills
        # public_skill = await skills_service.get_public_skill_by_name(skill_name)
        # if public_skill:
        #     pub_user_id = public_skill.get("user_id", user_id)
        #     logger.debug(f"Fetched public skill '{skill_name}' for user: {user_id}")
        #     return await _build_fetch_response(skill_name, pub_user_id, config)

        logger.debug(f"Skill '{skill_name}' not found for user: {user_id}")
        return f"Skill '{skill_name}' not found. Please check the skill name and try again."

    except Exception as e:
        logger.error(f"Error fetching skill '{skill_name}': {e}")
        raise ToolException(f"Failed to fetch skill: {str(e)}")


async def _build_fetch_response(
    skill_name: str, owner_user_id: str, config: RunnableConfig
) -> str:
    """
    Build the fetch_skill response by reading S3 content and optionally
    loading scripts/templates into the Code Interpreter.

    Args:
        skill_name: The skill name
        owner_user_id: The user_id that owns the skill (or "system")
        config: RunnableConfig for Code Interpreter session access

    Returns:
        Formatted response string
    """
    content = await skills_service.get_skill_s3_content(owner_user_id, skill_name)
    markdown = strip_frontmatter(content.get("markdown", "") or "")
    scripts = content.get("scripts", {})
    templates = content.get("templates", {})
    references = content.get("references", {})

    has_files = bool(scripts) or bool(templates) or bool(references)

    if not has_files:
        return markdown

    # Load scripts, templates, and references into Code Interpreter
    session_id = config.get("configurable", {}).get("thread_id", "unknown")
    user_id = _get_user_id_from_config(config)
    ci_path = f"/tmp/skills/{skill_name}"  # nosec B108

    # Build code to create directories and write files
    # Use json.dumps to safely escape all string values and prevent code injection
    file_writes = [
        f"import os, base64, json\n"
        f"os.makedirs({json.dumps(ci_path + '/scripts')}, exist_ok=True)\n"
        f"os.makedirs({json.dumps(ci_path + '/templates')}, exist_ok=True)\n"
        f"os.makedirs({json.dumps(ci_path + '/references')}, exist_ok=True)\n"
    ]

    for fname, file_content in scripts.items():
        safe_fname = os.path.basename(fname)
        file_writes.append(
            f"with open({json.dumps(ci_path + '/scripts/' + safe_fname)}, 'w') as f:\n"
            f"    f.write(json.loads({json.dumps(json.dumps(file_content))}))\n"
        )

    for fname, file_content in templates.items():
        safe_fname = os.path.basename(fname)
        b64 = base64.b64encode(file_content).decode("ascii")
        file_writes.append(
            f"with open({json.dumps(ci_path + '/templates/' + safe_fname)}, 'wb') as f:\n"
            f"    f.write(base64.b64decode({json.dumps(b64)}))\n"
        )

    for fname, file_content in references.items():
        safe_fname = os.path.basename(fname)
        file_writes.append(
            f"with open({json.dumps(ci_path + '/references/' + safe_fname)}, 'w') as f:\n"
            f"    f.write(json.loads({json.dumps(json.dumps(file_content))}))\n"
        )

    file_writes.append("print('FILES_LOADED')\n")
    load_code = "\n".join(file_writes)

    try:
        result = await code_interpreter_client.execute_code(
            session_id, load_code, user_id=user_id
        )
        if result.status == "error":
            logger.warning(
                f"Failed to load skill files into CI: {result.error_message or result.stderr}"
            )
    except Exception as e:
        logger.warning(f"Failed to load skill files into CI: {e}")

    # Build response with CI path info
    script_names = list(scripts.keys())
    template_names = list(templates.keys())
    reference_names = list(references.keys())

    response = markdown + "\n\n---\n"
    response += f"Scripts, templates, and references have been loaded into the Code Interpreter at: {ci_path}/\n"
    if script_names:
        response += f"Available scripts: {', '.join(f'scripts/{name}' for name in script_names)}\n"
    if template_names:
        response += f"Available templates: {', '.join(f'templates/{name}' for name in template_names)}\n"
    if reference_names:
        response += f"Available references (read on demand): {', '.join(f'references/{name}' for name in reference_names)}\n"

    return response


@tool(
    name_or_callable="manage_skill",
    description="""Create or update a skill with the given name, description, and instruction.

Skills are stored persistently and appear in the available_skills list for future conversations. You can optionally include Python scripts and reference files alongside the skill — existing files not included in an update are preserved.

Args:
    skill_name: Unique identifier (alphanumeric, underscores, hyphens, max 50 chars)
    description: Brief summary (max 200 chars) — shown in the system prompt
    instruction: Detailed procedure (max 40000 chars) — retrieved via fetch_skill
    scripts: Optional list of objects with 'filename' (.py) and 'content' keys
    references: Optional list of objects with 'filename' (.md) and 'content' keys — supplemental docs loaded into the Code Interpreter and referenced on demand

Returns:
    Success status with skill data, or validation errors if input is invalid.""",
)
async def manage_skill(
    skill_name: str,
    description: str,
    instruction: str,
    config: RunnableConfig,
    scripts: list[dict] | None = None,
    references: list[dict] | None = None,
) -> dict:
    """
    Create or update a skill.

    Args:
        skill_name: Unique identifier (alphanumeric, underscores, hyphens, max 50 chars)
        description: Brief summary (max 200 chars) shown in system prompt
        instruction: Detailed procedure (max 40000 chars)
        config: RunnableConfig injected at runtime (hidden from LLM)
        scripts: Optional list of dicts with 'filename' and 'content' keys
        references: Optional list of dicts with 'filename' (.md) and 'content' keys

    Returns:
        Success status and skill data, or validation errors

    """
    user_id = _get_user_id_from_config(config)

    errors = skills_service.validate_skill(skill_name, description, instruction)
    if errors:
        logger.warning(f"Validation errors for skill '{skill_name}': {errors}")
        return {
            "status": "error",
            "type": "validation_error",
            "error": "Validation failed",
            "fields": errors,
        }

    # Validate script filenames if provided
    if scripts:
        for script in scripts:
            filename = script.get("filename", "")
            if not filename or not filename.strip():
                return {
                    "status": "error",
                    "type": "validation_error",
                    "error": "Script filename cannot be empty",
                }
            if "/" in filename or "\\" in filename:
                return {
                    "status": "error",
                    "type": "validation_error",
                    "error": f"Script filename must not contain path separators: {filename}",
                }
            if not filename.endswith(".py"):
                return {
                    "status": "error",
                    "type": "validation_error",
                    "error": f"Script filename must end with .py: {filename}",
                }

    # Validate reference filenames if provided
    if references:
        for ref in references:
            filename = ref.get("filename", "")
            if not filename or not filename.strip():
                return {
                    "status": "error",
                    "type": "validation_error",
                    "error": "Reference filename cannot be empty",
                }
            if "/" in filename or "\\" in filename:
                return {
                    "status": "error",
                    "type": "validation_error",
                    "error": f"Reference filename must not contain path separators: {filename}",
                }
            if not filename.endswith(".md"):
                return {
                    "status": "error",
                    "type": "validation_error",
                    "error": f"Reference filename must end with .md: {filename}",
                }

    try:
        skill = await skills_service.create_or_update_skill(
            user_id,
            skill_name,
            description,
            instruction,
            scripts=scripts,
            references=references,
            created_by="llm",
        )

        logger.debug(f"Updated skill '{skill_name}' for user: {user_id}")
        return {
            "status": "success",
            "message": f"Skill '{skill_name}' saved successfully",
            "skill": {
                "skill_name": skill.get("skill_name"),
                "description": skill.get("description"),
                "updated_at": skill.get("updated_at"),
            },
        }

    except ValueError as e:
        logger.warning(f"Validation error updating skill '{skill_name}': {e}")
        error_val = e.args[0] if e.args else str(e)
        if isinstance(error_val, dict) and error_val.get("type") == "access_denied":
            return {
                "status": "error",
                "type": "access_denied",
                "error": error_val.get("error", str(e)),
            }
        return {"status": "error", "type": "validation_error", "error": str(e)}
    except Exception as e:
        logger.error(f"Error updating skill '{skill_name}': {e}")
        raise ToolException(f"Failed to update skill: {str(e)}")


@tool(
    name_or_callable="review_progress",
    description="""Pause to reflect on research progress at a natural checkpoint.

This is a blank reflection tool — you provide your self-reflection as input and the tool acknowledges it. Writing out your reflection helps you organize what you've gathered, identify gaps, and decide whether to continue searching or move to synthesis.

Use this when a research task involves multiple searches and you want to take stock before proceeding. For simpler queries that only need one or two searches, reflect in your thinking instead.

Args:
    reflection: Your assessment of research progress so far — what you've gathered, what gaps remain, and whether to continue searching or synthesize an answer.""",
)
def review_progress(reflection: str) -> dict:
    """
    A blank reflection tool that accepts the model's self-reflection.

    The model writes out its reflection as input, which helps it organize
    its thoughts. The tool simply acknowledges the reflection was recorded.

    Args:
        reflection: The model's self-reflection on research progress

    Returns:
        Simple acknowledgment that reflection was recorded
    """
    logger.debug(f"review_progress called with reflection of {len(reflection)} chars")
    return {
        "status": "success",
        "message": "Reflection recorded. Continue with your research or proceed to synthesis based on your assessment.",
    }


@tool(
    name_or_callable="execute_code",
    description="""Execute Python code in a persistent sandboxed environment.

Files created during execution persist across calls within the same session, so you can build up artifacts incrementally. Common Python packages are available, including python-pptx, pandas, matplotlib, and boto3.

When generating a downloadable file (e.g. .pptx, .csv, .pdf), save it to /tmp/<filename> and then call the generate_download_link tool with the file_path and a user-friendly filename so the user receives a download link.

To display tabular data, use the display_dataframe_to_user function from caas_jupyter_tools — it renders an interactive table in the UI. Avoid print(df) or manually built markdown tables for tabular output, as these produce plain text the user cannot interact with.
""",
)
async def execute_code(code: str, config: RunnableConfig) -> dict | list:
    """Execute Python code in the Code Interpreter session.

    Automatically captures matplotlib figures: patches plt.show() to save
    figures as base64 PNGs and returns them as image content blocks alongside
    the normal stdout output. No S3 round-trip needed.

    Also provides caas_jupyter_tools.display_dataframe_to_user(name, df)
    which captures DataFrames as HTML tables for inline display.

    Args:
        code: Python code to execute
        config: RunnableConfig injected at runtime

    Returns:
        dict with execution results, or list of content blocks if images/tables were captured
    """
    if not code or not code.strip():
        return {"status": "error", "error": "code is required"}

    session_id = config.get("configurable", {}).get("thread_id", "unknown")
    user_id = _get_user_id_from_config(config)

    # Preamble: patch plt.show() to auto-save figures as base64 PNGs
    _MPL_PREAMBLE = (
        "import sys as _sys\n"
        "_auto_captured_figs = []\n"
        "try:\n"
        "    import matplotlib\n"
        "    matplotlib.use('Agg')\n"
        "    import matplotlib.pyplot as _plt\n"
        "    _orig_show = _plt.show\n"
        "    def _patched_show(*_a, **_kw):\n"
        "        import io as _io, base64 as _b64\n"
        "        for _fnum in _plt.get_fignums():\n"
        "            _fig = _plt.figure(_fnum)\n"
        "            _buf = _io.BytesIO()\n"
        "            _fig.savefig(_buf, format='png', bbox_inches='tight', dpi=150)\n"
        "            _buf.seek(0)\n"
        "            _auto_captured_figs.append(_b64.b64encode(_buf.read()).decode('utf-8'))\n"
        "            _buf.close()\n"
        "        _plt.close('all')\n"
        "    _plt.show = _patched_show\n"
        "except ImportError:\n"
        "    pass\n"
    )

    # Preamble: provide caas_jupyter_tools.display_dataframe_to_user()
    _DF_PREAMBLE = (
        "import types as _types\n"
        "_auto_captured_dfs = []\n"
        "_caas_mod = _types.ModuleType('caas_jupyter_tools')\n"
        "def _display_df(name, dataframe):\n"
        "    import json as _j\n"
        "    _max_rows = 100\n"
        "    _truncated = len(dataframe) > _max_rows\n"
        "    _df_slice = dataframe.head(_max_rows)\n"
        "    _cols = list(_df_slice.columns)\n"
        "    _rows = _df_slice.values.tolist()\n"
        "    # Convert non-serializable values to strings\n"
        "    _clean_rows = []\n"
        "    for _r in _rows:\n"
        "        _clean_row = []\n"
        "        for _v in _r:\n"
        "            try:\n"
        "                _j.dumps(_v)\n"
        "                _clean_row.append(_v)\n"
        "            except (TypeError, ValueError):\n"
        "                _clean_row.append(str(_v))\n"
        "        _clean_rows.append(_clean_row)\n"
        "    _auto_captured_dfs.append({'name': name, 'columns': _cols, 'rows': _clean_rows, 'total_rows': len(dataframe), 'truncated': _truncated})\n"
        "_caas_mod.display_dataframe_to_user = _display_df\n"
        "_sys.modules['caas_jupyter_tools'] = _caas_mod\n"
    )

    # Postamble: print captured figures and DataFrames as JSON markers
    _POSTAMBLE = (
        "\nimport json as _json\n"
        "if _auto_captured_figs:\n"
        "    print('__MPL_FIGURES__:' + _json.dumps(_auto_captured_figs))\n"
        "if _auto_captured_dfs:\n"
        "    print('__DF_TABLES__:' + _json.dumps(_auto_captured_dfs))\n"
    )

    patched_code = _MPL_PREAMBLE + _DF_PREAMBLE + code + _POSTAMBLE

    try:
        result = await code_interpreter_client.execute_code(
            session_id, patched_code, user_id=user_id
        )
    except CodeInterpreterError as e:
        logger.error(f"Code Interpreter error: {e}")
        return {"status": "error", "error": f"Code Interpreter error: {e}"}

    if result.status == "error":
        return {
            "status": "error",
            "stderr": result.stderr,
            "error_message": result.error_message or result.stderr,
        }

    stdout = result.stdout or ""

    # Extract auto-captured matplotlib figures from stdout
    marker = "__MPL_FIGURES__:"
    marker_idx = stdout.find(marker)
    captured_b64 = []
    clean_stdout = stdout

    if marker_idx != -1:
        clean_stdout = stdout[:marker_idx].rstrip()
        figures_json = stdout[marker_idx + len(marker) :]
        # figures_json may also contain __DF_TABLES__ marker after it
        df_marker_in_fig = figures_json.find("\n__DF_TABLES__:")
        if df_marker_in_fig != -1:
            figures_json = figures_json[:df_marker_in_fig]
        try:
            captured_b64 = json.loads(figures_json)
        except json.JSONDecodeError:
            logger.warning("Failed to parse auto-captured figures JSON")

    # Extract auto-captured DataFrames from stdout
    df_marker = "__DF_TABLES__:"
    df_marker_idx = stdout.find(df_marker)
    captured_dfs = []

    if df_marker_idx != -1:
        if marker_idx == -1:
            # No figures marker, clean stdout is everything before df marker
            clean_stdout = stdout[:df_marker_idx].rstrip()
        df_json = stdout[df_marker_idx + len(df_marker) :]
        try:
            captured_dfs = json.loads(df_json)
        except json.JSONDecodeError:
            logger.warning("Failed to parse auto-captured DataFrames JSON")

    if not captured_b64 and not captured_dfs:
        return {"status": "success", "stdout": clean_stdout}

    # Build content blocks: stdout text + image blocks + DataFrame blocks
    content_blocks: list[dict] = []
    if clean_stdout.strip():
        content_blocks.append({"type": "text", "text": clean_stdout})

    for i, b64_data in enumerate(captured_b64):
        content_blocks.append({"type": "text", "text": f"figure_{i + 1}.png"})
        content_blocks.append(
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": b64_data,
                },
            }
        )

    for df_data in captured_dfs:
        # Build a markdown table for the LLM to see, and include structured
        # data so the frontend can render a rich table component
        name = df_data.get("name", "DataFrame")
        columns = df_data.get("columns", [])
        rows = df_data.get("rows", [])
        total_rows = df_data.get("total_rows", len(rows))
        truncated = df_data.get("truncated", False)

        # Short summary for the LLM — the frontend renders the rich table
        # via __dataframe__, so no need to send the full markdown table
        summary = (
            f"[DataFrame displayed: {name}, {total_rows} rows x {len(columns)} columns]"
        )

        content_blocks.append(
            {
                "type": "text",
                "text": summary,
                "__dataframe__": {
                    "name": name,
                    "columns": columns,
                    "rows": rows,
                    "total_rows": total_rows,
                    "truncated": truncated,
                },
            }
        )

    logger.debug(
        f"Auto-captured {len(captured_b64)} figure(s) and {len(captured_dfs)} DataFrame(s) from execute_code"
    )
    return content_blocks


@tool(
    name_or_callable="generate_download_link",
    description="""Upload a file from the Code Interpreter to S3 for download.

Call this tool AFTER the Code Interpreter has successfully created a file. The tool will:
1. Upload the file from the Code Interpreter session to S3

The frontend will generate a presigned download URL on demand when the user clicks download.

Args:
    file_path: The absolute path to the file inside the Code Interpreter session
               (e.g. "/tmp/presentation.pptx")
    filename: The display filename for the download (e.g. "quarterly_report.pptx")

Returns:
    On success: {status: "success", filename: "<filename>", s3_key: "<key>"}
    On failure: {status: "error", error: "<details>"}""",
)
async def generate_download_link(
    file_path: str,
    filename: str,
    config: RunnableConfig,
) -> dict:
    """Upload a file from Code Interpreter to S3 and return a presigned download URL.

    Args:
        file_path: Path to the file inside the Code Interpreter session
        filename: Display filename for the download
        config: RunnableConfig injected at runtime

    Returns:
        dict with status, url, and filename on success; error details on failure

    """
    if not file_path or not file_path.strip():
        return {"status": "error", "error": "file_path is required"}
    if not filename or not filename.strip():
        return {"status": "error", "error": "filename is required"}

    user_id = _get_user_id_from_config(config)
    session_id = config.get("configurable", {}).get("thread_id", "unknown")
    s3_bucket = code_interpreter_client.s3_bucket
    # Sanitize filename to prevent path traversal in S3 keys
    safe_filename = os.path.basename(filename)
    if not safe_filename:
        return {"status": "error", "error": "Invalid filename"}
    s3_key = f"artifact/{user_id}/{session_id}/{safe_filename}"

    # Step 1: Run upload code inside the Code Interpreter session
    # Use json.dumps to safely escape string values and prevent code injection
    upload_code = (
        f"import boto3, json\n"
        f"s3 = boto3.client('s3')\n"
        f"s3.upload_file({json.dumps(file_path)}, {json.dumps(s3_bucket)}, {json.dumps(s3_key)})\n"
        f"print('UPLOAD_OK')\n"
    )

    try:
        result = await code_interpreter_client.execute_code(session_id, upload_code)
    except CodeInterpreterError as e:
        logger.error(f"Code Interpreter error during S3 upload: {e}")
        return {"status": "error", "error": f"Code Interpreter error: {e}"}

    if result.status == "error" or "UPLOAD_OK" not in (result.stdout or ""):
        error_detail = result.error_message or result.stderr or "S3 upload failed"
        logger.error(f"S3 upload from Code Interpreter failed: {error_detail}")
        return {
            "status": "error",
            "error": f"Failed to upload file to S3: {error_detail}",
        }

    logger.debug(f"Download link generated for s3://{s3_bucket}/{s3_key}")
    return {
        "status": "success",
        "filename": filename,
        "s3_key": s3_key,
    }


@tool(
    name_or_callable="retrieve_images",
    description="""Retrieve images from the Code Interpreter session. Use this after generating or downloading images in the Code Interpreter and you need to retrieve the images. Max 5 images per call.

Set private to true if the images are intermediate/working artifacts that should not be displayed to the user (e.g. reference images for internal analysis). Private images are only visible to you""",
)
async def retrieve_images(
    image_paths: list[str], config: RunnableConfig, private: bool = True
) -> list[dict] | str:
    """Retrieve images from the Code Interpreter session.

    Args:
        image_paths: List of absolute file paths inside the Code Interpreter
                     (e.g. ["/tmp/images/chart.png"]). Max 5 paths.
        config: RunnableConfig injected at runtime (hidden from LLM)
        private: If True, images are marked as private and hidden from the main chat.

    Returns:
        List of alternating text/image content blocks, or error string.

    """
    # --- Input validation ---
    if not image_paths:
        return "No image paths provided. Please specify at least one image path."

    if len(image_paths) > 5:
        return "Too many image paths. Maximum 5 images per request."

    user_id = _get_user_id_from_config(config)
    session_id = config.get("configurable", {}).get("thread_id", "unknown")
    s3_bucket = code_interpreter_client.s3_bucket

    # --- Build and execute upload script in Code Interpreter ---
    image_paths_json = json.dumps(image_paths)
    upload_code = (
        "import boto3, json, os\n"
        "s3 = boto3.client('s3')\n"
        f"bucket = {json.dumps(s3_bucket)}\n"
        f"prefix = {json.dumps(f'img/{user_id}/{session_id}/')}\n"
        f"paths = {image_paths_json}\n"
        "manifest = {'uploaded': [], 'errors': []}\n"
        "for path in paths:\n"
        "    filename = os.path.basename(path)\n"
        "    s3_key = prefix + filename\n"
        "    try:\n"
        "        s3.upload_file(path, bucket, s3_key)\n"
        "        manifest['uploaded'].append({'path': path, 's3_key': s3_key, 'filename': filename})\n"
        "    except Exception as e:\n"
        "        manifest['errors'].append({'path': path, 'error': str(e)})\n"
        "print('MANIFEST:' + json.dumps(manifest))\n"
    )

    try:
        result = await code_interpreter_client.execute_code(
            session_id, upload_code, user_id=user_id
        )
    except CodeInterpreterError as e:
        logger.error(f"Code Interpreter error during image retrieval: {e}")
        raise ToolException(f"Code Interpreter session error: {e}")

    if result.status == "error":
        error_detail = result.error_message or result.stderr or "Upload script failed"
        logger.error(f"Image upload script failed: {error_detail}")
        raise ToolException(f"Image upload failed: {error_detail}")

    # --- Parse manifest from stdout ---
    stdout = result.stdout or ""
    manifest_marker = "MANIFEST:"
    marker_idx = stdout.find(manifest_marker)
    if marker_idx == -1:
        logger.error(f"No MANIFEST marker in CI stdout: {stdout}")
        raise ToolException(
            "Image upload failed: no manifest returned from Code Interpreter"
        )

    manifest_json = stdout[marker_idx + len(manifest_marker) :]
    try:
        manifest = json.loads(manifest_json)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse manifest JSON: {e}, raw: {manifest_json}")
        raise ToolException(
            "Image upload failed: malformed manifest from Code Interpreter"
        )

    logger.debug(
        f"Image upload manifest: uploaded={len(manifest.get('uploaded', []))}, errors={len(manifest.get('errors', []))}"
    )

    uploaded = manifest.get("uploaded", [])
    errors = manifest.get("errors", [])
    if not uploaded:
        if errors:
            error_details = "; ".join(
                f"{e.get('path', '?')}: {e.get('error', 'unknown')}" for e in errors
            )
            logger.warning(f"All image uploads failed: {error_details}")
            return f"No images could be uploaded. Errors: {error_details}"
        return "No images were found at the specified paths."

    # --- Download, resize, encode each image ---
    content_blocks: list[dict] = []
    success_count = 0

    for entry in uploaded:
        s3_key = entry["s3_key"]
        filename = entry["filename"]
        try:
            obj = await asyncio.to_thread(
                lambda: s3_client.get_object(Bucket=s3_bucket, Key=s3_key)
            )
            data = await asyncio.to_thread(obj["Body"].read)

            # Resize to max 1024px
            try:
                from PIL import Image

                img = Image.open(io.BytesIO(data))
                max_dim = 1024
                if img.width > max_dim or img.height > max_dim:
                    img.thumbnail((max_dim, max_dim), Image.LANCZOS)
                buf = io.BytesIO()
                img_format = "PNG" if s3_key.lower().endswith(".png") else "JPEG"
                img.save(buf, format=img_format, quality=80)
                data = buf.getvalue()
            except Exception as resize_err:
                logger.warning(
                    f"Could not resize image {s3_key}, using original: {resize_err}"
                )

            encoded = base64.b64encode(data).decode("utf-8")
            media_type = mimetypes.guess_type(filename)[0] or "image/png"

            content_blocks.append({"type": "text", "text": filename})
            content_blocks.append(
                {
                    "type": "image",
                    "__private__": private,
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": encoded,
                    },
                }
            )
            success_count += 1
        except Exception as e:
            logger.warning(f"Failed to download image {s3_key}: {e}")
            continue

    if success_count == 0:
        return "All image downloads failed. The images were uploaded but could not be retrieved from S3."

    return content_blocks


BrowserAction = Literal[
    "navigate",
    "click",
    "type",
    "press_key",
    "scroll",
    "hover",
    "screenshot",
    "get_text",
    "wait",
    "go_back",
    "go_forward",
]


@tool(
    name_or_callable="browser",
    description=(
        "Interact with a live browser session. "
        "Supported actions: navigate, click, type, press_key, scroll, hover, "
        "screenshot, get_text, wait, go_back, go_forward.\n"
        "Parameters vary by action:\n"
        "  navigate  — url (required)\n"
        "  click     — x, y coordinates OR selector\n"
        "  type      — text (required), optionally selector\n"
        "  press_key — key (e.g. 'Enter', 'Tab', 'Escape', 'Backspace')\n"
        "  scroll    — delta_x, delta_y (pixels, negative = down/right)\n"
        "  hover     — x, y coordinates OR selector\n"
        "  screenshot — no extra params, returns page screenshot\n"
        "  get_text  — no extra params, returns page text content\n"
        "  wait      — selector (optional), timeout in ms (default 3000)\n"
        "  go_back / go_forward — no extra params"
    ),
)
async def browse_web(
    action: BrowserAction,
    url: str = "",
    x: int = 0,
    y: int = 0,
    text: str = "",
    selector: str = "",
    key: str = "",
    delta_x: int = 0,
    delta_y: int = 0,
    timeout: int = 3000,
    config: RunnableConfig = None,
) -> dict | list:
    """Execute a browser action in a live browser session.

    Args:
        action: The action to perform (navigate, click, type, etc.).
        url: URL for navigate action.
        x: X coordinate for click/hover/scroll.
        y: Y coordinate for click/hover/scroll.
        text: Text to type for type action.
        selector: CSS selector for click/type/hover/wait.
        key: Key name for press_key action.
        delta_x: Horizontal scroll amount.
        delta_y: Vertical scroll amount.
        timeout: Timeout in ms for wait action.
        config: RunnableConfig injected at runtime.

    Returns:
        dict with status and content.
    """
    thread_id = config.get("configurable", {}).get("thread_id", "unknown")
    _user_id = _get_user_id_from_config(config)  # noqa: F841

    try:
        session_info = await browser_client.get_or_create_session(thread_id)
    except BrowserToolError as e:
        logger.error(f"Browser session error: {e}")
        raise ToolException(str(e)) from e

    # Always dispatch the live endpoint so the frontend can show the viewer
    writer = get_stream_writer()
    writer(
        {
            "name": "browser_session_started",
            "data": {
                "browser_session_id": session_info["browser_session_id"],
                "url_lifetime": session_info["url_lifetime"],
                "viewport": session_info.get("viewport"),
                "status": "active",
            },
        }
    )

    # Check if user has taken control of the browser (skip for screenshot action)
    if action != "screenshot" and browser_client.is_user_controlled(thread_id):
        lock_id = browser_client.get_lock_id(thread_id)
        writer({"name": "browser_control_paused", "data": {"lock_id": lock_id}})

        elapsed = 0
        while browser_client.is_user_controlled(thread_id) and elapsed < 900:
            await asyncio.sleep(5)
            elapsed += 5

        if elapsed >= 900:
            # Timeout: clean the lock from state and send resumed event so the pair is complete
            browser_client.clear_user_controlled(thread_id)
            writer({"name": "browser_control_resumed", "data": {}})
            return {
                "status": "timeout",
                "content": "User did not release browser control within 15 minutes. Lock has been cleared.",
            }
        else:
            # User released control — send resumed event and capture current state
            writer({"name": "browser_control_resumed", "data": {}})
            result = await browser_client.invoke_browser(thread_id, action="screenshot")
            # Return image blocks with a text description so the LLM sees both
            image_blocks = (
                result.get("content", [])
                if isinstance(result.get("content"), list)
                else []
            )
            return [
                {
                    "type": "text",
                    "text": (
                        "The user took manual control of the browser and has now released it. "
                        "Review the current browser state shown in the screenshot before proceeding."
                    ),
                },
                *image_blocks,
            ]

    try:
        result = await browser_client.invoke_browser(
            thread_id,
            action=action,
            url=url,
            x=x,
            y=y,
            text=text,
            selector=selector,
            key=key,
            delta_x=delta_x,
            delta_y=delta_y,
            timeout=timeout,
        )
        # If the result contains structured content blocks (e.g. screenshot images),
        # return them as a flat list so LangGraph passes them as proper image blocks
        # to the LLM instead of serializing the whole dict as a JSON string.
        if (
            isinstance(result, dict)
            and isinstance(result.get("content"), list)
            and result["content"]
            and isinstance(result["content"][0], dict)
            and result["content"][0].get("type") == "image"
        ):
            return result["content"]
        return result
    except Exception as e:
        logger.error(f"Browser action '{action}' failed: {e}")
        raise ToolException(f"Browser action '{action}' failed: {str(e)}") from e
