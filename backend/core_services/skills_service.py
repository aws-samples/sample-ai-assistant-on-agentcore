"""
Skills Service for Core-Services.

Provides CRUD operations for managing user skills in DynamoDB.
Skills are stored with user_id (PK) and skill_name (SK) partitioning.

This service extends the Sparky skills service with:
- Pagination support for list_skills
- Create vs update distinction for duplicate detection

"""

from typing import Optional, Dict, Any
from datetime import datetime, timezone
import boto3
from botocore.exceptions import ClientError
import logging
import re

from config import SKILLS_TABLE, REGION

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def parse_frontmatter(content: str) -> tuple[dict, str]:
    """Parse YAML frontmatter. Returns (metadata_dict, body)."""
    match = _FRONTMATTER_RE.match(content)
    if not match:
        return {}, content
    metadata = {}
    for line in match.group(1).split("\n"):
        if ":" in line:
            key, _, val = line.partition(":")
            metadata[key.strip()] = val.strip()
    return metadata, content[match.end() :]


def strip_frontmatter(content: str) -> str:
    """Return body only, stripping YAML frontmatter."""
    _, body = parse_frontmatter(content)
    return body


import os

SKILLS_S3_BUCKET = os.environ.get("SKILLS_S3_BUCKET")

# Configure logger
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Validation constants
MAX_SKILL_NAME_LENGTH = 50
MAX_DESCRIPTION_LENGTH = 200
MAX_INSTRUCTION_LENGTH = 60000
VALID_VISIBILITY_VALUES = {"public", "private"}
SKILL_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")


class SkillsService:
    """
    Service for managing skills in DynamoDB.

    Provides operations for:
    - Getting a skill by name
    - Listing all skills for a user with pagination
    - Creating skills (with duplicate detection)
    - Updating existing skills
    - Deleting skills
    - Validating skill data
    """

    def __init__(
        self,
        table_name: Optional[str] = None,
        region: Optional[str] = None,
        s3_bucket: Optional[str] = None,
    ):
        """
        Initialize SkillsService with DynamoDB table and S3 bucket configuration.

        Args:
            table_name: DynamoDB table name. Defaults to SKILLS_TABLE env var.
            region: AWS region. Defaults to REGION env var.
            s3_bucket: S3 bucket for skill content. Defaults to SKILLS_S3_BUCKET env var.

        Raises:
            ValueError: If SKILLS_S3_BUCKET environment variable is not set and no s3_bucket is provided.
        """
        self.table_name = table_name or SKILLS_TABLE
        self.region = region or REGION
        self.s3_bucket = s3_bucket or SKILLS_S3_BUCKET
        if not self.s3_bucket:
            raise ValueError("SKILLS_S3_BUCKET environment variable is not set")
        self.dynamodb = boto3.resource("dynamodb", region_name=self.region)
        self.table = self.dynamodb.Table(self.table_name)
        self.s3 = boto3.client("s3", region_name=self.region)
        logger.debug(
            f"SkillsService initialized with table: {self.table_name}, bucket: {self.s3_bucket}"
        )

    # --- S3 helper methods ---

    def _s3_content_path(self, user_id: str, skill_name: str) -> str:
        """Return the S3 key prefix for a skill's content: {user_id}/{skill_name}/"""
        return f"{user_id}/{skill_name}/"

    def _write_s3_object(self, key: str, content: str) -> None:
        """Write a UTF-8 string to an S3 object."""
        self.s3.put_object(Bucket=self.s3_bucket, Key=key, Body=content.encode("utf-8"))

    def _read_s3_object(self, key: str) -> Optional[str]:
        """Read a UTF-8 string from an S3 object. Returns None if not found."""
        try:
            response = self.s3.get_object(Bucket=self.s3_bucket, Key=key)
            return response["Body"].read().decode("utf-8")
        except ClientError as e:
            if e.response["Error"]["Code"] == "NoSuchKey":
                return None
            raise

    def _read_s3_object_bytes(self, key: str) -> Optional[bytes]:
        """Read raw bytes from an S3 object. Returns None if not found."""
        try:
            response = self.s3.get_object(Bucket=self.s3_bucket, Key=key)
            return response["Body"].read()
        except ClientError as e:
            if e.response["Error"]["Code"] == "NoSuchKey":
                return None
            raise

    def _delete_s3_prefix(self, prefix: str) -> None:
        """Delete all S3 objects under the given prefix."""
        paginator = self.s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.s3_bucket, Prefix=prefix):
            objects = page.get("Contents", [])
            if objects:
                self.s3.delete_objects(
                    Bucket=self.s3_bucket,
                    Delete={"Objects": [{"Key": obj["Key"]} for obj in objects]},
                )

    def _list_s3_objects(self, prefix: str) -> list[str]:
        """List all S3 object keys under the given prefix."""
        keys = []
        paginator = self.s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self.s3_bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                keys.append(obj["Key"])
        return keys

    def _validate_reference_filename(self, filename: str) -> None:
        """
        Validate that a reference filename ends with .md and contains no path separators.

        Raises:
            ValueError: If filename is invalid
        """
        if not filename or not filename.strip():
            raise ValueError("Reference filename cannot be empty")
        if "/" in filename or "\\" in filename:
            raise ValueError(
                f"Reference filename must not contain path separators: {filename}"
            )
        if not filename.endswith(".md"):
            raise ValueError(f"Reference filename must end with .md: {filename}")

    def _validate_script_filename(self, filename: str) -> None:
        """
        Validate that a script filename ends with .py and contains no path separators.

        Args:
            filename: The script filename to validate

        Raises:
            ValueError: If filename is invalid

        """
        if not filename or not filename.strip():
            raise ValueError("Script filename cannot be empty")
        if "/" in filename or "\\" in filename:
            raise ValueError(
                f"Script filename must not contain path separators: {filename}"
            )
        if not filename.endswith(".py"):
            raise ValueError(f"Script filename must end with .py: {filename}")

    async def write_scripts(
        self, user_id: str, skill_name: str, scripts: list[dict]
    ) -> None:
        """
        Write Python scripts to a skill's scripts/ subfolder in S3.

        Each script dict must have 'filename' and 'content' keys.
        Validates each filename before writing.

        Args:
            user_id: The skill owner's user ID
            skill_name: The skill name
            scripts: List of dicts with 'filename' and 'content' keys

        Raises:
            ValueError: If any script filename is invalid

        """
        s3_prefix = self._s3_content_path(user_id, skill_name)
        for script in scripts:
            filename = script.get("filename", "")
            content = script.get("content", "")
            self._validate_script_filename(filename)
            s3_key = f"{s3_prefix}scripts/{filename}"
            self._write_s3_object(s3_key, content)

    async def list_skill_scripts(self, user_id: str, skill_name: str) -> list[str]:
        """
        List script filenames under a skill's scripts/ prefix in S3.

        Args:
            user_id: The skill owner's user ID
            skill_name: The skill name

        Returns:
            List of script filenames (without the path prefix)

        """
        s3_prefix = f"{self._s3_content_path(user_id, skill_name)}scripts/"
        keys = self._list_s3_objects(s3_prefix)
        return [key[len(s3_prefix) :] for key in keys if key != s3_prefix]

    async def get_skill_content(self, user_id: str, skill_name: str) -> dict:
        """
        Return full skill content: SKILL.md markdown, script filenames, and template filenames.

        Args:
            user_id: The skill owner's user ID
            skill_name: The skill name

        Returns:
            Dict with keys: markdown (str|None), scripts (list[dict]), templates (list[str])

        """
        s3_prefix = self._s3_content_path(user_id, skill_name)

        # Read SKILL.md — strip frontmatter before returning to the UI
        markdown = strip_frontmatter(self._read_s3_object(f"{s3_prefix}SKILL.md") or "")

        # List scripts and read their content
        scripts_prefix = f"{s3_prefix}scripts/"
        script_keys = self._list_s3_objects(scripts_prefix)
        scripts = []
        for key in script_keys:
            if key == scripts_prefix:
                continue
            filename = key[len(scripts_prefix) :]
            content = self._read_s3_object(key)
            scripts.append({"filename": filename, "content": content or ""})

        # List templates (filenames only for UI display)
        templates_prefix = f"{s3_prefix}templates/"
        template_keys = self._list_s3_objects(templates_prefix)
        templates = [
            key[len(templates_prefix) :]
            for key in template_keys
            if key != templates_prefix
        ]

        # List references and read their content
        references_prefix = f"{s3_prefix}references/"
        reference_keys = self._list_s3_objects(references_prefix)
        references = []
        for key in reference_keys:
            if key == references_prefix:
                continue
            filename = key[len(references_prefix) :]
            content = self._read_s3_object(key)
            references.append({"filename": filename, "content": content or ""})

        return {
            "markdown": markdown,
            "scripts": scripts,
            "templates": templates,
            "references": references,
        }

    MAX_TEMPLATE_SIZE_BYTES = 50 * 1024 * 1024  # 50MB

    async def upload_template(
        self, user_id: str, skill_name: str, filename: str, content_bytes: bytes
    ) -> None:
        """
        Upload a template file to S3 at /{user_id}/{skill_name}/templates/{filename}.

        Args:
            user_id: The skill owner's user ID
            skill_name: The skill name
            filename: The template filename
            content_bytes: The raw file content as bytes

        Raises:
            ValueError: If filename is empty, contains path separators, or content exceeds 50MB

        """
        if not filename or not filename.strip():
            raise ValueError("Template filename cannot be empty")
        if "/" in filename or "\\" in filename:
            raise ValueError(
                f"Template filename must not contain path separators: {filename}"
            )
        if len(content_bytes) > self.MAX_TEMPLATE_SIZE_BYTES:
            raise ValueError(f"Template file exceeds maximum size of 50MB: {filename}")

        s3_prefix = self._s3_content_path(user_id, skill_name)
        key = f"{s3_prefix}templates/{filename}"
        self.s3.put_object(Bucket=self.s3_bucket, Key=key, Body=content_bytes)
        logger.info(
            f"Uploaded template '{filename}' for skill '{skill_name}' "
            f"(user: {user_id}, size: {len(content_bytes)} bytes)"
        )

    async def delete_template(
        self, user_id: str, skill_name: str, filename: str
    ) -> None:
        """
        Delete a template file from S3.

        Args:
            user_id: The skill owner's user ID
            skill_name: The skill name
            filename: The template filename to delete

        Raises:
            ValueError: If filename is empty or contains path separators

        """
        if not filename or not filename.strip():
            raise ValueError("Template filename cannot be empty")
        if "/" in filename or "\\" in filename:
            raise ValueError(
                f"Template filename must not contain path separators: {filename}"
            )

        s3_prefix = self._s3_content_path(user_id, skill_name)
        key = f"{s3_prefix}templates/{filename}"
        self.s3.delete_object(Bucket=self.s3_bucket, Key=key)
        logger.info(
            f"Deleted template '{filename}' for skill '{skill_name}' (user: {user_id})"
        )

    async def delete_script(self, user_id: str, skill_name: str, filename: str) -> None:
        """
        Delete a script file from S3.

        Args:
            user_id: The skill owner's user ID
            skill_name: The skill name
            filename: The script filename to delete

        Raises:
            ValueError: If filename is empty, contains path separators, or doesn't end with .py
        """
        self._validate_script_filename(filename)
        self.guard_system_skill(user_id)

        s3_prefix = self._s3_content_path(user_id, skill_name)
        key = f"{s3_prefix}scripts/{filename}"
        self.s3.delete_object(Bucket=self.s3_bucket, Key=key)
        logger.info(
            f"Deleted script '{filename}' for skill '{skill_name}' (user: {user_id})"
        )

    async def upload_reference(
        self, user_id: str, skill_name: str, filename: str, content: str
    ) -> None:
        """
        Upload a reference file to S3 at /{user_id}/{skill_name}/references/{filename}.

        Args:
            user_id: The skill owner's user ID
            skill_name: The skill name
            filename: The reference filename (must end with .md)
            content: The text content of the reference file

        Raises:
            ValueError: If filename is empty, contains path separators, or doesn't end with .md

        """
        self.guard_system_skill(user_id)
        if not filename or not filename.strip():
            raise ValueError("Reference filename cannot be empty")
        if "/" in filename or "\\" in filename:
            raise ValueError(
                f"Reference filename must not contain path separators: {filename}"
            )
        if not filename.endswith(".md"):
            raise ValueError(f"Reference filename must end with .md: {filename}")

        s3_prefix = self._s3_content_path(user_id, skill_name)
        key = f"{s3_prefix}references/{filename}"
        self.s3.put_object(Bucket=self.s3_bucket, Key=key, Body=content.encode("utf-8"))
        logger.info(
            f"Uploaded reference '{filename}' for skill '{skill_name}' (user: {user_id})"
        )

    async def delete_reference(
        self, user_id: str, skill_name: str, filename: str
    ) -> None:
        """
        Delete a reference file from S3.

        Args:
            user_id: The skill owner's user ID
            skill_name: The skill name
            filename: The reference filename to delete

        Raises:
            ValueError: If filename is empty or contains path separators

        """
        self.guard_system_skill(user_id)
        if not filename or not filename.strip():
            raise ValueError("Reference filename cannot be empty")
        if "/" in filename or "\\" in filename:
            raise ValueError(
                f"Reference filename must not contain path separators: {filename}"
            )

        s3_prefix = self._s3_content_path(user_id, skill_name)
        key = f"{s3_prefix}references/{filename}"
        self.s3.delete_object(Bucket=self.s3_bucket, Key=key)
        logger.info(
            f"Deleted reference '{filename}' for skill '{skill_name}' (user: {user_id})"
        )

    def validate_skill_name(self, skill_name: str) -> None:
        """
        Validate skill name format and length.

        Args:
            skill_name: The skill name to validate

        Raises:
            ValueError: If skill_name is invalid with specific error message

        """
        if not skill_name or not skill_name.strip():
            raise ValueError("skill_name: Skill name cannot be empty")

        skill_name = skill_name.strip()

        if len(skill_name) > MAX_SKILL_NAME_LENGTH:
            raise ValueError(
                f"skill_name: Must be {MAX_SKILL_NAME_LENGTH} characters or less"
            )

        if not SKILL_NAME_PATTERN.match(skill_name):
            raise ValueError(
                "skill_name: Must contain only alphanumeric characters, "
                "underscores, and hyphens"
            )

    def validate_description(self, description: str) -> None:
        """
        Validate description length.

        Args:
            description: The description to validate

        Raises:
            ValueError: If description is invalid with specific error message

        """
        if not description or not description.strip():
            raise ValueError("description: Description cannot be empty")

        if len(description) > MAX_DESCRIPTION_LENGTH:
            raise ValueError(
                f"description: Must be {MAX_DESCRIPTION_LENGTH} characters or less"
            )

    def validate_instruction(self, instruction: str) -> None:
        """
        Validate instruction length.

        Args:
            instruction: The instruction to validate

        Raises:
            ValueError: If instruction is invalid with specific error message

        """
        if not instruction or not instruction.strip():
            raise ValueError("instruction: Instruction cannot be empty")

        if len(instruction) > MAX_INSTRUCTION_LENGTH:
            raise ValueError(
                f"instruction: Must be {MAX_INSTRUCTION_LENGTH} characters or less"
            )

    def validate_visibility(self, visibility: str) -> None:
        """
        Validate visibility value.

        Args:
            visibility: The visibility value to validate

        Raises:
            ValueError: If visibility is not 'public' or 'private'

        """
        if visibility not in VALID_VISIBILITY_VALUES:
            raise ValueError("visibility: visibility must be 'public' or 'private'")

    def validate_skill(
        self, skill_name: str, description: str, instruction: str
    ) -> Dict[str, str]:
        """
        Validate all skill fields and return any validation errors.

        Args:
            skill_name: The skill name to validate
            description: The description to validate
            instruction: The instruction to validate

        Returns:
            Dict of field names to error messages (empty if all valid)
        """
        errors = {}

        try:
            self.validate_skill_name(skill_name)
        except ValueError as e:
            field, message = str(e).split(": ", 1)
            errors[field] = message

        try:
            self.validate_description(description)
        except ValueError as e:
            field, message = str(e).split(": ", 1)
            errors[field] = message

        try:
            self.validate_instruction(instruction)
        except ValueError as e:
            field, message = str(e).split(": ", 1)
            errors[field] = message

        return errors

    async def get_skill(
        self, user_id: str, skill_name: str
    ) -> Optional[Dict[str, Any]]:
        """
        Fetch a single skill by name.

        Retrieves metadata from DynamoDB and content from S3.

        Args:
            user_id: The authenticated user ID from JWT token
            skill_name: The name of the skill to fetch

        Returns:
            Dict containing the full skill data (metadata + instruction from S3),
            or None if not found

        """
        try:
            response = self.table.get_item(
                Key={"user_id": user_id, "skill_name": skill_name}
            )

            item = response.get("Item")

            if item:
                logger.debug(f"Retrieved skill '{skill_name}' for user: {user_id}")
                # Fetch instruction content from S3
                s3_content_path = item.get("s3_content_path")
                if s3_content_path:
                    s3_key = f"{s3_content_path}SKILL.md"
                    content = self._read_s3_object(s3_key)
                    if content is not None:
                        item["instruction"] = content
                return item
            else:
                logger.debug(f"Skill '{skill_name}' not found for user: {user_id}")
                return None

        except ClientError as e:
            logger.error(f"Error getting skill '{skill_name}' for user {user_id}: {e}")
            raise

    async def list_skills(
        self,
        user_id: str,
        limit: int = 50,
        last_evaluated_key: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        List all skills for a user with pagination.

        Returns name, description, created_at, and updated_at for each skill.

        Args:
            user_id: The authenticated user ID from JWT token
            limit: Maximum number of skills to return (default 50)
            last_evaluated_key: Pagination cursor from previous request

        Returns:
            Dict containing:
                - skills: List of skill summaries
                - last_evaluated_key: Pagination cursor for next page (None if no more)
                - has_more: Boolean indicating if more pages exist

        """
        try:
            query_params = {
                "KeyConditionExpression": "user_id = :uid",
                "ExpressionAttributeValues": {":uid": user_id},
                "ProjectionExpression": "user_id, skill_name, description, created_at, updated_at, visibility, created_by",
                "Limit": limit,
            }

            if last_evaluated_key:
                query_params["ExclusiveStartKey"] = last_evaluated_key

            response = self.table.query(**query_params)

            skills = [
                s
                for s in response.get("Items", [])
                if s.get("skill_name") != "__config__"
            ]
            new_last_key = response.get("LastEvaluatedKey")

            logger.debug(
                f"Listed {len(skills)} skills for user: {user_id} "
                f"(has_more: {new_last_key is not None})"
            )

            return {
                "skills": skills,
                "last_evaluated_key": new_last_key,
                "has_more": new_last_key is not None,
            }

        except ClientError as e:
            logger.error(f"Error listing skills for user {user_id}: {e}")
            raise

    async def skill_exists(self, user_id: str, skill_name: str) -> bool:
        """
        Check if a skill exists for a user.

        Args:
            user_id: The authenticated user ID from JWT token
            skill_name: The name of the skill to check

        Returns:
            True if skill exists, False otherwise
        """
        skill = await self.get_skill(user_id, skill_name)
        return skill is not None

    async def create_skill(
        self,
        user_id: str,
        skill_name: str,
        description: str,
        instruction: str = "",
        created_by: str = "user",
        visibility: str = "private",
    ) -> Dict[str, Any]:
        """
        Create a new skill.

        Validates all fields before write. Rejects if skill already exists.

        Args:
            user_id: The authenticated user ID from JWT token
            skill_name: Unique identifier for the skill
            description: Brief summary (max 200 chars)
            instruction: Detailed procedure (max 40000 chars)
            created_by: Who created the skill ("user" or "llm")
            visibility: "public" or "private" (default "private")

        Returns:
            Dict containing the created skill data

        Raises:
            ValueError: If validation fails or skill already exists

        """
        # Validate fields (instruction is optional — managed via SKILL.md)
        errors = {}
        try:
            self.validate_skill_name(skill_name)
        except ValueError as e:
            field, message = str(e).split(": ", 1)
            errors[field] = message
        try:
            self.validate_description(description)
        except ValueError as e:
            field, message = str(e).split(": ", 1)
            errors[field] = message
        if instruction and instruction.strip():
            try:
                self.validate_instruction(instruction)
            except ValueError as e:
                field, message = str(e).split(": ", 1)
                errors[field] = message
        if errors:
            raise ValueError(errors)

        # Validate visibility
        self.validate_visibility(visibility)

        # Normalize skill_name
        skill_name = skill_name.strip()

        # Check if skill already exists (duplicate detection)
        if await self.skill_exists(user_id, skill_name):
            raise ValueError(
                {
                    "type": "skill_exists",
                    "skill_name": f"Skill '{skill_name}' already exists",
                }
            )

        # Prevent creating a skill that conflicts with a system skill name
        system_skill = await self.get_system_skill(skill_name)
        if system_skill:
            raise ValueError(
                {
                    "type": "skill_exists",
                    "skill_name": f"A system skill named '{skill_name}' already exists. Choose a different name.",
                }
            )

        now = datetime.now(timezone.utc).isoformat()

        s3_content_path = self._s3_content_path(user_id, skill_name)

        item = {
            "user_id": user_id,
            "skill_name": skill_name,
            "description": description.strip(),
            "created_at": now,
            "updated_at": now,
            "created_by": created_by,
            "visibility": visibility,
            "s3_content_path": s3_content_path,
        }

        try:
            # Write content to S3 first, then metadata to DynamoDB
            s3_key = f"{s3_content_path}SKILL.md"
            self._write_s3_object(s3_key, instruction.strip())

            # Use conditional write to prevent race conditions
            self.table.put_item(
                Item=item,
                ConditionExpression=(
                    "attribute_not_exists(user_id) AND attribute_not_exists(skill_name)"
                ),
            )
            logger.debug(f"Created skill '{skill_name}' for user: {user_id}")
            # Include instruction in the returned dict for API compatibility
            result = dict(item)
            result["instruction"] = instruction.strip()
            return result

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")
            if error_code == "ConditionalCheckFailedException":
                # Skill was created between our check and write
                raise ValueError(
                    {
                        "type": "skill_exists",
                        "skill_name": f"Skill '{skill_name}' already exists",
                    }
                )
            logger.error(f"Error creating skill '{skill_name}' for user {user_id}: {e}")
            raise

    async def update_skill(
        self,
        user_id: str,
        skill_name: str,
        description: str,
        instruction: Optional[str] = None,
        visibility: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Update an existing skill.

        Validates all fields before write. Rejects if skill doesn't exist.
        Metadata is stored in DynamoDB (no instruction field).
        If instruction is provided, SKILL.md is updated in S3.

        Args:
            user_id: The authenticated user ID from JWT token
            skill_name: The skill to update
            description: New description (max 200 chars)
            instruction: Optional new instruction content to write to S3
            visibility: Optional new visibility ("public" or "private")

        Returns:
            Dict containing the updated skill data

        Raises:
            ValueError: If validation fails, skill doesn't exist, or system skill

        """
        # Reject modifications to system skills
        self.guard_system_skill(user_id)

        # Validate fields
        errors = {}
        try:
            self.validate_skill_name(skill_name)
        except ValueError as e:
            field, message = str(e).split(": ", 1)
            errors[field] = message

        try:
            self.validate_description(description)
        except ValueError as e:
            field, message = str(e).split(": ", 1)
            errors[field] = message

        if instruction is not None:
            try:
                self.validate_instruction(instruction)
            except ValueError as e:
                field, message = str(e).split(": ", 1)
                errors[field] = message

        if errors:
            raise ValueError(errors)

        # Validate visibility if provided
        if visibility is not None:
            self.validate_visibility(visibility)

        # Normalize skill_name
        skill_name = skill_name.strip()

        # Check if skill exists
        existing = await self.get_skill(user_id, skill_name)
        if not existing:
            raise ValueError(
                {
                    "type": "skill_not_found",
                    "skill_name": f"Skill '{skill_name}' not found",
                }
            )

        now = datetime.now(timezone.utc).isoformat()

        s3_content_path = existing.get("s3_content_path") or self._s3_content_path(
            user_id, skill_name
        )

        item = {
            "user_id": user_id,
            "skill_name": skill_name,
            "description": description.strip(),
            "created_at": existing.get("created_at"),
            "updated_at": now,
            "created_by": existing.get("created_by", "user"),
            "visibility": visibility
            if visibility is not None
            else existing.get("visibility", "private"),
            "s3_content_path": s3_content_path,
        }

        try:
            # Optionally update SKILL.md in S3
            if instruction is not None:
                s3_key = f"{s3_content_path}SKILL.md"
                self._write_s3_object(s3_key, instruction.strip())

            self.table.put_item(Item=item)
            logger.debug(f"Updated skill '{skill_name}' for user: {user_id}")

            # Include instruction in the returned dict for API compatibility
            result = dict(item)
            if instruction is not None:
                result["instruction"] = instruction.strip()
            return result

        except ClientError as e:
            logger.error(f"Error updating skill '{skill_name}' for user {user_id}: {e}")
            raise

    async def delete_skill(self, user_id: str, skill_name: str) -> bool:
        """
        Delete a skill from DynamoDB and all its S3 content.

        Deletes all S3 objects under the skill's content path, then removes
        the DynamoDB record.

        Args:
            user_id: The authenticated user ID from JWT token
            skill_name: The name of the skill to delete

        Returns:
            True (always succeeds - idempotent)

        Raises:
            ValueError: If attempting to delete a system skill

        """
        # Reject deletion of system skills
        self.guard_system_skill(user_id)

        try:
            # Delete all S3 content under the skill's prefix
            s3_prefix = self._s3_content_path(user_id, skill_name)
            self._delete_s3_prefix(s3_prefix)

            # Delete DynamoDB record
            self.table.delete_item(Key={"user_id": user_id, "skill_name": skill_name})
            logger.debug(
                f"Deleted skill '{skill_name}' and S3 content for user: {user_id}"
            )
            return True

        except ClientError as e:
            logger.error(f"Error deleting skill '{skill_name}' for user {user_id}: {e}")
            raise

    async def list_public_skills(
        self, limit: int = 50, last_evaluated_key: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        List all public skills across all users using the GSI.

        Args:
            limit: Maximum number of skills to return (default 50)
            last_evaluated_key: Pagination cursor from previous request

        Returns:
            Dict containing:
                - skills: List of public skill summaries
                - last_evaluated_key: Pagination cursor for next page (None if no more)
                - has_more: Boolean indicating if more pages exist

        """
        try:
            query_params = {
                "IndexName": "visibility-updated_at-index",
                "KeyConditionExpression": "visibility = :vis",
                "ExpressionAttributeValues": {":vis": "public"},
                "ProjectionExpression": "skill_name, description, user_id, created_at, updated_at",
                "ScanIndexForward": False,
                "Limit": limit,
            }

            if last_evaluated_key:
                query_params["ExclusiveStartKey"] = last_evaluated_key

            response = self.table.query(**query_params)

            skills = response.get("Items", [])
            new_last_key = response.get("LastEvaluatedKey")

            logger.debug(
                f"Listed {len(skills)} public skills "
                f"(has_more: {new_last_key is not None})"
            )

            return {
                "skills": skills,
                "last_evaluated_key": new_last_key,
                "has_more": new_last_key is not None,
            }

        except ClientError as e:
            logger.error(f"Error listing public skills: {e}")
            raise

    async def get_public_skill(
        self, creator_user_id: str, skill_name: str
    ) -> Optional[Dict[str, Any]]:
        """
        Get a specific public skill by creator user_id and skill_name.

        Returns the full skill only if its visibility is "public".

        Args:
            creator_user_id: The user_id of the skill creator
            skill_name: The name of the skill

        Returns:
            Dict containing the full skill data if public, None otherwise

        """
        try:
            response = self.table.get_item(
                Key={"user_id": creator_user_id, "skill_name": skill_name}
            )

            item = response.get("Item")

            if item and item.get("visibility") == "public":
                logger.debug(
                    f"Retrieved public skill '{skill_name}' "
                    f"by creator: {creator_user_id}"
                )
                return item
            else:
                logger.debug(
                    f"Public skill '{skill_name}' not found or not public "
                    f"for creator: {creator_user_id}"
                )
                return None

        except ClientError as e:
            logger.error(
                f"Error getting public skill '{skill_name}' "
                f"for creator {creator_user_id}: {e}"
            )
            raise

    CONFIG_SKILL_NAME = "__config__"

    async def get_disabled_skills(self, user_id: str) -> set:
        """Get the set of disabled skill names for a user.

        Queries the user's config record (skill_name='__config__') and returns
        the disabled_skills string set attribute.

        Args:
            user_id: The user's ID

        Returns:
            Set of disabled skill names, or empty set if none

        """
        try:
            response = self.table.get_item(
                Key={"user_id": user_id, "skill_name": self.CONFIG_SKILL_NAME},
                ProjectionExpression="disabled_skills",
            )
            item = response.get("Item")
            if item and "disabled_skills" in item:
                return set(item["disabled_skills"])
            return set()
        except ClientError as e:
            logger.error(f"Error getting disabled skills for user {user_id}: {e}")
            raise

    async def toggle_skill(self, user_id: str, skill_name: str, disabled: bool) -> None:
        """Enable or disable a skill for a user.

        Uses DynamoDB ADD/DELETE on the disabled_skills string set for atomic,
        idempotent updates.

        Args:
            user_id: The user's ID
            skill_name: The skill name to toggle
            disabled: True to disable, False to enable

        """
        try:
            if disabled:
                self.table.update_item(
                    Key={"user_id": user_id, "skill_name": self.CONFIG_SKILL_NAME},
                    UpdateExpression="ADD disabled_skills :s",
                    ExpressionAttributeValues={":s": {skill_name}},
                )
            else:
                self.table.update_item(
                    Key={"user_id": user_id, "skill_name": self.CONFIG_SKILL_NAME},
                    UpdateExpression="DELETE disabled_skills :s",
                    ExpressionAttributeValues={":s": {skill_name}},
                )
            logger.debug(
                f"Toggled skill '{skill_name}' to disabled={disabled} for user {user_id}"
            )
        except ClientError as e:
            logger.error(f"Error toggling skill '{skill_name}' for user {user_id}: {e}")
            raise

    SYSTEM_USER_ID = "system"

    def is_system_skill(self, user_id: str) -> bool:
        """Return True if user_id identifies a system skill.

        Args:
            user_id: The user ID to check

        Returns:
            True if user_id == "system"

        """
        return user_id == self.SYSTEM_USER_ID

    def guard_system_skill(self, user_id: str) -> None:
        """Raise ValueError if attempting to modify a system skill.

        Args:
            user_id: The user ID to check

        Raises:
            ValueError: If user_id is "system"

        """
        if self.is_system_skill(user_id):
            raise ValueError(
                {
                    "type": "access_denied",
                    "error": "System skills are read-only and cannot be modified or deleted",
                }
            )

    async def list_system_skills(self) -> list[dict]:
        """Query DynamoDB for all system skills (user_id='system').

        Returns:
            List of system skill metadata dicts

        """
        try:
            response = self.table.query(
                KeyConditionExpression="user_id = :uid",
                ExpressionAttributeValues={":uid": self.SYSTEM_USER_ID},
                ProjectionExpression="user_id, skill_name, description, created_at, updated_at, visibility, created_by",
            )
            skills = response.get("Items", [])
            # Mark each as a system skill for the caller
            for skill in skills:
                skill["is_system"] = True
            logger.debug(f"Listed {len(skills)} system skills")
            return skills
        except ClientError as e:
            logger.error(f"Error listing system skills: {e}")
            raise

    async def get_system_skill(self, skill_name: str) -> Optional[Dict[str, Any]]:
        """Get a system skill's metadata from DynamoDB and content from S3.

        Args:
            skill_name: The system skill name

        Returns:
            Dict containing the full system skill data, or None if not found

        """
        try:
            response = self.table.get_item(
                Key={"user_id": self.SYSTEM_USER_ID, "skill_name": skill_name}
            )
            item = response.get("Item")
            if item:
                # Fetch instruction content from S3
                s3_content_path = item.get("s3_content_path")
                if s3_content_path:
                    s3_key = f"{s3_content_path}SKILL.md"
                    content = self._read_s3_object(s3_key)
                    if content is not None:
                        item["instruction"] = content
                item["is_system"] = True
                logger.debug(f"Retrieved system skill '{skill_name}'")
                return item
            else:
                logger.debug(f"System skill '{skill_name}' not found")
                return None
        except ClientError as e:
            logger.error(f"Error getting system skill '{skill_name}': {e}")
            raise


# Global service instance
skills_service = SkillsService()
