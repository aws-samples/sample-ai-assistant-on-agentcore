"""
Skills Service for Sparky Agent.

Provides CRUD operations for managing user skills in DynamoDB.
Skills are stored with user_id (PK) and skill_name (SK) partitioning.
Skill content (Markdown, scripts, templates) is stored in S3.
"""

from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
import asyncio
import boto3
from botocore.exceptions import ClientError
import os
import logging
import re

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


# Configure logger
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Environment configuration
SKILLS_TABLE = os.environ.get("SKILLS_TABLE", "sparky-skills")
REGION = os.environ.get("REGION", "us-east-1")
SKILLS_S3_BUCKET = os.environ.get("SKILLS_S3_BUCKET", "")

if not SKILLS_S3_BUCKET:
    raise ValueError("SKILLS_S3_BUCKET environment variable is required but not set")

# Validation constants
MAX_SKILL_NAME_LENGTH = 50
MAX_DESCRIPTION_LENGTH = 200
MAX_INSTRUCTION_LENGTH = 60000
SKILL_NAME_PATTERN = re.compile(r"^[a-zA-Z0-9_-]+$")


class SkillsService:
    """
    Service for managing skills in DynamoDB.

    Provides operations for:
    - Getting a skill by name
    - Listing all skills for a user
    - Creating or updating skills
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
            s3_bucket: S3 bucket for skill content. Defaults to S3_BUCKET env var.
        """
        self.table_name = table_name or SKILLS_TABLE
        self.region = region or REGION
        self.s3_bucket = s3_bucket or SKILLS_S3_BUCKET
        self.dynamodb = boto3.resource("dynamodb", region_name=self.region)
        self.table = self.dynamodb.Table(self.table_name)
        self.s3 = boto3.client("s3", region_name=self.region)
        logger.debug(
            f"SkillsService initialized with table: {self.table_name}, bucket: {self.s3_bucket}"
        )

    # --- S3 helper methods ---

    SYSTEM_USER_ID = "system"

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

    def _validate_script_filename(self, filename: str) -> None:
        """
        Validate that a script filename ends with .py and contains no path separators.

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

    def is_system_skill(self, user_id: str) -> bool:
        """Return True if user_id identifies a system skill."""
        return user_id == self.SYSTEM_USER_ID

    def guard_system_skill(self, user_id: str) -> None:
        """Raise ValueError if attempting to modify a system skill."""
        if self.is_system_skill(user_id):
            raise ValueError(
                {
                    "type": "access_denied",
                    "error": "System skills are read-only and cannot be modified or deleted",
                }
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
                "skill_name: Must contain only alphanumeric characters, underscores, and hyphens"
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
            Dict containing the skill data (metadata + instruction from S3),
            or None if not found

        """
        try:
            response = await asyncio.to_thread(
                lambda: self.table.get_item(
                    Key={"user_id": user_id, "skill_name": skill_name}
                )
            )

            item = response.get("Item")

            if item:
                logger.debug(f"Retrieved skill '{skill_name}' for user: {user_id}")
                # Fetch instruction content from S3
                s3_content_path = item.get("s3_content_path")
                if s3_content_path:
                    s3_key = f"{s3_content_path}SKILL.md"
                    content = await asyncio.to_thread(self._read_s3_object, s3_key)
                    if content is not None:
                        item["instruction"] = content
                return item
            else:
                logger.debug(f"Skill '{skill_name}' not found for user: {user_id}")
                return None

        except ClientError as e:
            logger.error(f"Error getting skill '{skill_name}' for user {user_id}: {e}")
            raise

    async def list_skills(self, user_id: str) -> List[Dict[str, Any]]:
        """
        List all skills for a user (name and description only).

        Args:
            user_id: The authenticated user ID from JWT token

        Returns:
            List of dicts containing skill_name and description

        """
        try:
            response = await asyncio.to_thread(
                lambda: self.table.query(
                    KeyConditionExpression="user_id = :uid",
                    ExpressionAttributeValues={":uid": user_id},
                    ProjectionExpression="skill_name, description",
                )
            )

            skills = [
                s
                for s in response.get("Items", [])
                if s.get("skill_name") != self.CONFIG_SKILL_NAME
            ]
            logger.debug(f"Listed {len(skills)} skills for user: {user_id}")
            return skills

        except ClientError as e:
            logger.error(f"Error listing skills for user {user_id}: {e}")
            raise

    async def create_or_update_skill(
        self,
        user_id: str,
        skill_name: str,
        description: str,
        instruction: str,
        scripts: Optional[list[dict]] = None,
        references: Optional[list[dict]] = None,
        created_by: str = "llm",
    ) -> Dict[str, Any]:
        """
        Create or update a skill.

        Writes metadata to DynamoDB (no instruction field) and SKILL.md to S3.
        Optionally writes scripts and references to S3. Existing files not in the update are preserved.

        Args:
            user_id: The authenticated user ID from JWT token
            skill_name: Unique identifier for the skill
            description: Brief summary (max 200 chars)
            instruction: Detailed procedure (max 40000 chars), written to S3 as SKILL.md
            scripts: Optional list of dicts with 'filename' and 'content' keys
            references: Optional list of dicts with 'filename' (.md) and 'content' keys
            created_by: Who created the skill ("user" or "llm")

        Returns:
            Dict containing the skill metadata

        Raises:
            ValueError: If validation fails or system skill modification attempted

        """
        # Reject modifications to system skills
        self.guard_system_skill(user_id)

        # Validate all fields
        errors = self.validate_skill(skill_name, description, instruction)
        if errors:
            raise ValueError(errors)

        # Validate script filenames if provided
        if scripts:
            for script in scripts:
                self._validate_script_filename(script.get("filename", ""))

        # Validate reference filenames if provided
        if references:
            for ref in references:
                self._validate_reference_filename(ref.get("filename", ""))

        # Normalize skill_name
        skill_name = skill_name.strip()

        now = datetime.now(timezone.utc).isoformat()

        # Check if skill exists to preserve created_at
        existing = await self.get_skill(user_id, skill_name)

        # Prevent creating a new skill that conflicts with a system skill name
        if not existing:
            system_skill = await self.get_system_skill(skill_name)
            if system_skill:
                raise ValueError(
                    f"skill_name: A system skill named '{skill_name}' already exists. Choose a different name."
                )

        s3_content_path = self._s3_content_path(user_id, skill_name)

        if existing:
            # Update existing skill - preserve created_at and visibility
            item = {
                "user_id": user_id,
                "skill_name": skill_name,
                "description": description.strip(),
                "created_at": existing.get("created_at", now),
                "updated_at": now,
                "created_by": existing.get("created_by", created_by),
                "visibility": existing.get("visibility", "private"),
                "s3_content_path": s3_content_path,
            }
        else:
            # Create new skill
            item = {
                "user_id": user_id,
                "skill_name": skill_name,
                "description": description.strip(),
                "created_at": now,
                "updated_at": now,
                "created_by": created_by,
                "visibility": "private",
                "s3_content_path": s3_content_path,
            }

        try:
            # Write SKILL.md to S3
            s3_key = f"{s3_content_path}SKILL.md"
            await asyncio.to_thread(self._write_s3_object, s3_key, instruction.strip())

            # Write scripts to S3 if provided (preserves existing scripts not in update)
            if scripts:
                for script in scripts:
                    filename = script.get("filename", "")
                    content = script.get("content", "")
                    script_key = f"{s3_content_path}scripts/{filename}"
                    await asyncio.to_thread(self._write_s3_object, script_key, content)

            # Write references to S3 if provided (preserves existing references not in update)
            if references:
                for ref in references:
                    filename = ref.get("filename", "")
                    content = ref.get("content", "")
                    ref_key = f"{s3_content_path}references/{filename}"
                    await asyncio.to_thread(self._write_s3_object, ref_key, content)

            # Write metadata to DynamoDB (no instruction field)
            await asyncio.to_thread(lambda: self.table.put_item(Item=item))
            logger.debug(
                f"{'Updated' if existing else 'Created'} skill '{skill_name}' for user: {user_id}"
            )
            return item

        except ClientError as e:
            logger.error(f"Error saving skill '{skill_name}' for user {user_id}: {e}")
            raise

    async def delete_skill(self, user_id: str, skill_name: str) -> bool:
        """
        Delete a skill from DynamoDB and all its S3 content.

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
            await asyncio.to_thread(self._delete_s3_prefix, s3_prefix)

            # Delete DynamoDB record
            await asyncio.to_thread(
                lambda: self.table.delete_item(
                    Key={"user_id": user_id, "skill_name": skill_name}
                )
            )
            logger.debug(
                f"Deleted skill '{skill_name}' and S3 content for user: {user_id}"
            )
            return True

        except ClientError as e:
            logger.error(f"Error deleting skill '{skill_name}' for user {user_id}: {e}")
            raise

    async def get_skill_s3_content(self, user_id: str, skill_name: str) -> dict:
        """
        Return full skill content from S3: markdown, script contents, and template contents.

        Args:
            user_id: The skill owner's user ID
            skill_name: The skill name

        Returns:
            Dict with keys:
                - markdown (str|None): SKILL.md content
                - scripts (dict): {filename: content} for each script
                - templates (dict): {filename: content_bytes} for each template

        """
        s3_prefix = self._s3_content_path(user_id, skill_name)

        # Read SKILL.md
        markdown = await asyncio.to_thread(self._read_s3_object, f"{s3_prefix}SKILL.md")

        # Read scripts with content
        scripts = {}
        scripts_prefix = f"{s3_prefix}scripts/"
        script_keys = await asyncio.to_thread(self._list_s3_objects, scripts_prefix)
        for key in script_keys:
            if key != scripts_prefix:
                filename = key[len(scripts_prefix) :]
                content = await asyncio.to_thread(self._read_s3_object, key)
                if content is not None:
                    scripts[filename] = content

        # Read templates with content (as raw bytes to support binary files)
        templates = {}
        templates_prefix = f"{s3_prefix}templates/"
        template_keys = await asyncio.to_thread(self._list_s3_objects, templates_prefix)
        for key in template_keys:
            if key != templates_prefix:
                filename = key[len(templates_prefix) :]
                content = await asyncio.to_thread(self._read_s3_object_bytes, key)
                if content is not None:
                    templates[filename] = content

        # Read references with content (text files)
        references = {}
        references_prefix = f"{s3_prefix}references/"
        reference_keys = await asyncio.to_thread(
            self._list_s3_objects, references_prefix
        )
        for key in reference_keys:
            if key != references_prefix:
                filename = key[len(references_prefix) :]
                content = await asyncio.to_thread(self._read_s3_object, key)
                if content is not None:
                    references[filename] = content

        return {
            "markdown": markdown,
            "scripts": scripts,
            "templates": templates,
            "references": references,
        }

    async def list_public_skills(self) -> List[Dict[str, Any]]:
        """
        List all public skills across all users using the GSI.

        Returns a list of dicts with skill_name, description, and user_id
        for prompt injection and discovery.

        Returns:
            List of public skill summaries

        """
        try:
            all_skills = []
            last_evaluated_key = None

            while True:
                query_params = {
                    "IndexName": "visibility-updated_at-index",
                    "KeyConditionExpression": "visibility = :vis",
                    "ExpressionAttributeValues": {":vis": "public"},
                    "ProjectionExpression": "skill_name, description, user_id",
                    "ScanIndexForward": False,
                }

                if last_evaluated_key:
                    query_params["ExclusiveStartKey"] = last_evaluated_key

                response = await asyncio.to_thread(
                    lambda: self.table.query(**query_params)
                )

                all_skills.extend(response.get("Items", []))
                last_evaluated_key = response.get("LastEvaluatedKey")

                if not last_evaluated_key:
                    break

            logger.debug(f"Listed {len(all_skills)} public skills")
            return all_skills

        except ClientError as e:
            logger.error(f"Error listing public skills: {e}")
            raise

    async def get_public_skill_by_name(
        self, skill_name: str
    ) -> Optional[Dict[str, Any]]:
        """
        Find a public skill by name across all users.

        Queries the GSI with visibility="public" and filters on skill_name.
        Returns the first match or None.

        Args:
            skill_name: The name of the skill to find

        Returns:
            Dict containing the full skill data if found, None otherwise

        """
        try:
            response = await asyncio.to_thread(
                lambda: self.table.query(
                    IndexName="visibility-updated_at-index",
                    KeyConditionExpression="visibility = :vis",
                    ExpressionAttributeValues={
                        ":vis": "public",
                        ":sn": skill_name,
                    },
                    FilterExpression="skill_name = :sn",
                )
            )

            items = response.get("Items", [])

            if items:
                skill = items[0]
                logger.debug(
                    f"Found public skill '{skill_name}' by user: {skill.get('user_id')}"
                )
                # Fetch instruction from S3 if available
                s3_content_path = skill.get("s3_content_path")
                if s3_content_path:
                    s3_key = f"{s3_content_path}SKILL.md"
                    content = await asyncio.to_thread(self._read_s3_object, s3_key)
                    if content is not None:
                        skill["instruction"] = content
                return skill
            else:
                logger.debug(f"Public skill '{skill_name}' not found")
                return None

        except ClientError as e:
            logger.error(f"Error getting public skill '{skill_name}': {e}")
            raise

    async def list_system_skills(self) -> list[dict]:
        """Query DynamoDB for all system skills (user_id='system').

        Returns:
            List of system skill metadata dicts

        """
        try:
            response = await asyncio.to_thread(
                lambda: self.table.query(
                    KeyConditionExpression="user_id = :uid",
                    ExpressionAttributeValues={":uid": self.SYSTEM_USER_ID},
                    ProjectionExpression="skill_name, description",
                )
            )
            skills = response.get("Items", [])
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
            response = await asyncio.to_thread(
                lambda: self.table.get_item(
                    Key={"user_id": self.SYSTEM_USER_ID, "skill_name": skill_name}
                )
            )
            item = response.get("Item")
            if item:
                s3_content_path = item.get("s3_content_path")
                if s3_content_path:
                    s3_key = f"{s3_content_path}SKILL.md"
                    content = await asyncio.to_thread(self._read_s3_object, s3_key)
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
            response = await asyncio.to_thread(
                lambda: self.table.get_item(
                    Key={"user_id": user_id, "skill_name": self.CONFIG_SKILL_NAME},
                    ProjectionExpression="disabled_skills",
                )
            )
            item = response.get("Item")
            if item and "disabled_skills" in item:
                return set(item["disabled_skills"])
            return set()
        except ClientError as e:
            logger.error(f"Error getting disabled skills for user {user_id}: {e}")
            raise


# Global service instance
skills_service = SkillsService()
