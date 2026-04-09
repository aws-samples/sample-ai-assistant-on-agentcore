"""
Project KB Service for Core-Services.

Triggers Bedrock Knowledge Base S3 ingestion jobs after file
uploads or deletions. The KB data source is S3-backed — Bedrock
reads directly from the projects bucket, so ingestion jobs are
the mechanism for syncing the vector index with S3 state.
"""

import boto3
from botocore.exceptions import ClientError

from config import PROJECTS_KB_DATA_SOURCE_ID, PROJECTS_KB_ID, REGION
from utils import logger


class ProjectKBService:
    def __init__(self):
        # bedrock-agent is the management plane (ingestion jobs, KB CRUD)
        # bedrock-agent-runtime is the data plane (Retrieve, InvokeAgent)
        self.client = boto3.client("bedrock-agent", region_name=REGION)
        self.kb_id = PROJECTS_KB_ID
        self.data_source_id = PROJECTS_KB_DATA_SOURCE_ID

    def get_ingestion_job_status(self, job_id: str) -> str:
        """
        Return the Bedrock ingestion job status string.
        Possible values: STARTING, IN_PROGRESS, COMPLETE, FAILED, STOPPING, STOPPED.
        Returns empty string if KB is not configured or the call fails.
        """
        if not self.kb_id or not self.data_source_id or not job_id:
            return ""
        try:
            response = self.client.get_ingestion_job(
                knowledgeBaseId=self.kb_id,
                dataSourceId=self.data_source_id,
                ingestionJobId=job_id,
            )
            return response["ingestionJob"]["status"]
        except ClientError as e:
            logger.error(
                f"Failed to get ingestion job status for {job_id}: {e.response['Error']}"
            )
            return ""

    def get_latest_ingestion_job_status(self) -> str:
        """
        Return the status of the most recently started ingestion job.
        Used for files whose ingestion_job_id was not captured (e.g. ConflictException
        caused start_ingestion_job to return "" while another job was already running).
        Returns empty string if KB is not configured or no jobs exist.
        """
        if not self.kb_id or not self.data_source_id:
            return ""
        try:
            response = self.client.list_ingestion_jobs(
                knowledgeBaseId=self.kb_id,
                dataSourceId=self.data_source_id,
                sortBy={"attribute": "STARTED_AT", "order": "DESCENDING"},
                maxResults=1,
            )
            jobs = response.get("ingestionJobSummaries", [])
            return jobs[0]["status"] if jobs else ""
        except ClientError as e:
            logger.warning(f"Failed to list ingestion jobs: {e.response['Error']}")
            return ""

    def start_ingestion_job(self) -> str:
        """
        Trigger an S3 sync ingestion job on the projects KB.

        Bedrock performs an incremental sync: new files are indexed,
        deleted files are removed from the vector index. Returns the
        ingestion job ID for diagnostic tracking.

        Returns:
            ingestion_job_id str, or empty string if KB is not configured.
        """
        if not self.kb_id or not self.data_source_id:
            logger.warning("Projects KB not configured — skipping ingestion job")
            return ""

        try:
            response = self.client.start_ingestion_job(
                knowledgeBaseId=self.kb_id,
                dataSourceId=self.data_source_id,
            )
            job_id = response["ingestionJob"]["ingestionJobId"]
            logger.debug(f"Started projects KB ingestion job: {job_id}")
            return job_id
        except ClientError as e:
            # A job may already be running — this is non-fatal; Bedrock
            # will queue the next sync when the current one finishes.
            error_code = e.response["Error"]["Code"]
            if error_code == "ConflictException":
                logger.info("Projects KB ingestion job already in progress — skipping")
                return ""
            logger.error(f"Failed to start projects KB ingestion job: {e}")
            raise


project_kb_service = ProjectKBService()
