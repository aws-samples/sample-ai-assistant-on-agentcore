"""
Project File Manager for Core-Services.

Handles S3 operations for project files:
- Presigned PUT URL generation for direct client uploads
- Metadata sidecar writes (server-side, never client-supplied)
- HeadObject validation after upload
- Object deletion (file + sidecar)
- Batch deletion for cascade project deletes
"""

import json
import uuid
from typing import Any, Dict, List
from urllib.parse import quote

import boto3
from botocore.exceptions import ClientError

from config import PROJECTS_S3_BUCKET, REGION
from utils import logger

MAX_FILE_SIZE_BYTES = 1_073_741_824  # 1 GB
PRESIGNED_URL_EXPIRY_SECONDS = 900  # 15 minutes

DOCUMENT_CONTENT_TYPES = {
    "text/plain",
    "text/markdown",
    "text/html",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

DOCUMENT_EXTENSIONS = {".txt", ".md", ".html", ".htm", ".pdf", ".docx"}

# Structured data files — stored under the data/ S3 prefix, never ingested into KB
STRUCTURED_EXTENSIONS = {
    ".csv",
    ".tsv",
    ".json",
    ".yaml",
    ".yml",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".parquet",
    ".jsonl",
    ".arrow",
    ".feather",
}


class ProjectFileManager:
    def __init__(self):
        self.s3 = boto3.client("s3", region_name=REGION)
        self.bucket = PROJECTS_S3_BUCKET

    def validate_file(self, filename: str, content_type: str, size_bytes: int) -> None:
        """Raise ValueError with a descriptive code if the file is not acceptable."""
        ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if ext in STRUCTURED_EXTENSIONS:
            pass  # Accept any content type for structured data files
        elif ext in DOCUMENT_EXTENSIONS:
            if content_type not in DOCUMENT_CONTENT_TYPES:
                raise ValueError(f"unsupported_content_type:{content_type}")
        else:
            raise ValueError(f"unsupported_file_type:{ext}")
        if size_bytes > MAX_FILE_SIZE_BYTES:
            raise ValueError("file_too_large")

    def build_s3_key(
        self,
        user_id: str,
        project_id: str,
        file_id: str,
        filename: str,
        category: str = "document",
    ) -> str:
        prefix = "data" if category == "data" else "docs"
        return f"{prefix}/{user_id}/{project_id}/{file_id}/{filename}"

    def build_metadata_s3_key(self, s3_key: str) -> str:
        return f"{s3_key}.metadata.json"

    def generate_download_url(
        self,
        s3_key: str,
        filename: str,
    ) -> str:
        """
        Generate a presigned GET URL for downloading a project file.

        Returns a presigned URL string valid for PRESIGNED_URL_EXPIRY_SECONDS.
        """
        return self.s3.generate_presigned_url(
            "get_object",
            Params={
                "Bucket": self.bucket,
                "Key": s3_key,
                "ResponseContentDisposition": f"attachment; filename*=UTF-8''{quote(filename)}",
            },
            ExpiresIn=PRESIGNED_URL_EXPIRY_SECONDS,
        )

    def generate_upload_url(
        self,
        user_id: str,
        project_id: str,
        file_id: str,
        filename: str,
        content_type: str,
        category: str = "document",
    ) -> Dict[str, str]:
        """
        Generate a presigned PUT URL for direct client upload.

        Returns dict with upload_url and s3_key.
        """
        s3_key = self.build_s3_key(user_id, project_id, file_id, filename, category)
        upload_url = self.s3.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self.bucket,
                "Key": s3_key,
                "ContentType": content_type,
            },
            ExpiresIn=PRESIGNED_URL_EXPIRY_SECONDS,
        )
        return {"upload_url": upload_url, "s3_key": s3_key}

    def object_exists(self, s3_key: str) -> bool:
        """HeadObject check — returns True if the object exists in S3."""
        try:
            self.s3.head_object(Bucket=self.bucket, Key=s3_key)
            return True
        except ClientError as e:
            if e.response["Error"]["Code"] in ("404", "NoSuchKey"):
                return False
            raise

    def write_metadata_sidecar(
        self,
        s3_key: str,
        project_id: str,
        user_id: str,
        file_id: str,
        filename: str,
    ) -> str:
        """
        Write the Bedrock KB metadata sidecar alongside the document.

        Bedrock KB S3 data source reads {document_key}.metadata.json and
        attaches the metadataAttributes to every indexed chunk, enabling
        per-project retrieval filtering.

        Returns the sidecar S3 key.
        """
        metadata_key = self.build_metadata_s3_key(s3_key)
        sidecar = {
            "metadataAttributes": {
                "project_id": project_id,
                "user_id": user_id,
                "file_id": file_id,
                "filename": filename,
            }
        }
        self.s3.put_object(
            Bucket=self.bucket,
            Key=metadata_key,
            Body=json.dumps(sidecar).encode("utf-8"),
            ContentType="application/json",
        )
        logger.debug(f"Wrote metadata sidecar to {metadata_key}")
        return metadata_key

    def copy_from_artifact(
        self,
        source_bucket: str,
        source_key: str,
        user_id: str,
        project_id: str,
        file_id: str,
        filename: str,
        category: str,
    ) -> tuple[str, int]:
        """Copy an artifact from the CI/artifact S3 bucket to the project bucket.

        Returns (dest_s3_key, size_bytes).
        """
        dest_key = self.build_s3_key(user_id, project_id, file_id, filename, category)
        head = self.s3.head_object(Bucket=source_bucket, Key=source_key)
        size_bytes = head.get("ContentLength", 0)
        if size_bytes > MAX_FILE_SIZE_BYTES:
            raise ValueError(
                f"Source file is too large ({size_bytes} bytes). Maximum allowed is {MAX_FILE_SIZE_BYTES} bytes."
            )
        self.s3.copy_object(
            CopySource={"Bucket": source_bucket, "Key": source_key},
            Bucket=self.bucket,
            Key=dest_key,
            MetadataDirective="COPY",
        )
        logger.debug(f"Copied artifact {source_key} → {dest_key}")
        return dest_key, size_bytes

    def delete_file_objects(self, s3_key: str, metadata_s3_key: str) -> None:
        """Delete both the document and its metadata sidecar from S3."""
        keys = [s3_key, metadata_s3_key]
        self._delete_keys(keys)

    def delete_objects_batch(self, key_pairs: List[Dict[str, str]]) -> None:
        """
        Delete multiple file + sidecar pairs in batches of 1000.

        key_pairs: list of {"s3_key": "...", "metadata_s3_key": "..."}
        """
        flat_keys = []
        for pair in key_pairs:
            flat_keys.append(pair["s3_key"])
            flat_keys.append(pair["metadata_s3_key"])
        self._delete_keys(flat_keys)

    def _delete_keys(self, keys: List[str]) -> None:
        """Delete a list of S3 keys in batches of 1000 (S3 delete_objects limit)."""
        for i in range(0, len(keys), 1000):
            batch = keys[i : i + 1000]
            objects = [{"Key": k} for k in batch]
            self.s3.delete_objects(
                Bucket=self.bucket,
                Delete={"Objects": objects, "Quiet": True},
            )
        logger.debug(f"Deleted {len(keys)} S3 objects from projects bucket")


project_file_manager = ProjectFileManager()
