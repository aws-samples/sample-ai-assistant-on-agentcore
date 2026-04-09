"""
KB Search Service module for searching chat conversations in Amazon Bedrock Knowledge Base.

This module provides functionality to search indexed chat conversations using
hybrid search (semantic + keyword) with reranking for improved relevance.
All searches are scoped to the authenticated user via metadata filtering.

"""

import asyncio
from dataclasses import dataclass
from typing import List, Optional, Dict, Any
import boto3

from config import KB_ID, RERANK_MODEL_ARN, KB_SEARCH_TYPE
from utils import logger


# Configuration constants
MAX_QUERY_LENGTH = 500
MIN_SIMILARITY_SCORE = 0.4
DEFAULT_RESULT_LIMIT = 10
RETRIEVE_OVERSAMPLE_FACTOR = 2  # Fetch more results for reranking


@dataclass
class SearchResult:
    """Represents a single search result from the Knowledge Base.

    Attributes:
        session_id: The chat session identifier
        message_index: The sequential position of the message in the session
        title: The chat session description/title
        content: The message content (truncated for display)
        score: The relevance score from reranking
    """

    session_id: str
    message_index: int
    title: str
    content: str
    score: float


class KBSearchService:
    """Service for searching the Bedrock Knowledge Base.

    Provides hybrid search with user-scoped filtering and reranking
    for finding relevant chat conversations.

    Attributes:
        kb_id: The Bedrock Knowledge Base identifier
        rerank_model_arn: The ARN of the Bedrock rerank model
        bedrock_agent_runtime: Boto3 client for Bedrock Agent Runtime

    """

    def __init__(
        self, kb_id: Optional[str] = None, rerank_model_arn: Optional[str] = None
    ):
        """Initialize the KB Search Service.

        Args:
            kb_id: Knowledge Base ID. If None, reads from KB_ID env var.
            rerank_model_arn: Rerank model ARN. If None, reads from RERANK_MODEL_ARN env var.
        """
        self.kb_id = kb_id or KB_ID
        self.rerank_model_arn = rerank_model_arn or RERANK_MODEL_ARN
        self.enabled = self.kb_id is not None

        if self.enabled:
            self.bedrock_agent_runtime = boto3.client("bedrock-agent-runtime")
            logger.debug(f"KB Search Service initialized with KB: {self.kb_id}")
        else:
            self.bedrock_agent_runtime = None
            logger.debug("KB Search Service disabled - no KB_ID configured")

    async def search(
        self, query: str, user_id: str, limit: int = DEFAULT_RESULT_LIMIT
    ) -> List[SearchResult]:
        """Search KB with hybrid retrieval and reranking.

        Performs a hybrid search (semantic + keyword) on the Knowledge Base,
        filtered by user_id metadata, then reranks results for improved relevance.

        Args:
            query: Search query
            user_id: User ID for metadata filtering
            limit: Max results to return

        Returns:
            List of SearchResult objects sorted by relevance

        """
        if not self.enabled:
            logger.warning("KB Search Service disabled, returning empty results")
            return []

        if not query or not query.strip():
            return []

        # Truncate query to max length
        truncated_query = query[:MAX_QUERY_LENGTH]

        # Enforce result limit
        limit = min(limit, DEFAULT_RESULT_LIMIT)

        try:
            # Step 1: Retrieve from KB with hybrid search and user filter
            retrieve_results = await self._retrieve_from_kb(
                truncated_query,
                user_id,
                limit * RETRIEVE_OVERSAMPLE_FACTOR,  # Fetch more for reranking
            )

            if not retrieve_results:
                return []

            # Step 2: Filter by similarity score threshold
            filtered_results = [
                result
                for result in retrieve_results
                if result.get("score", 0) >= MIN_SIMILARITY_SCORE
            ]

            if not filtered_results:
                return []

            # Step 2.5: Deduplicate by (session_id, message_index), keeping highest score
            seen = {}
            for result in filtered_results:
                key = (result.get("session_id", ""), result.get("message_index", 0))
                if key not in seen or result.get("score", 0) > seen[key].get(
                    "score", 0
                ):
                    seen[key] = result
            filtered_results = list(seen.values())

            # Step 3: Rerank results if rerank model is configured
            if self.rerank_model_arn:
                reranked_results = await self._rerank_results(
                    truncated_query, filtered_results, limit
                )
            else:
                # Fall back to original order if no rerank model
                reranked_results = filtered_results[:limit]

            # Step 4: Convert to SearchResult objects
            return self._convert_to_search_results(reranked_results)

        except Exception as e:
            logger.error(f"KB search failed: {e}")
            raise

    async def _retrieve_from_kb(
        self, query: str, user_id: str, num_results: int
    ) -> List[Dict[str, Any]]:
        """Retrieve documents from KB using hybrid search with user filter.

        Args:
            query: The search query
            user_id: User ID for metadata filtering
            num_results: Number of results to retrieve

        Returns:
            List of retrieval results with metadata

        """
        retrieve_request = {
            "knowledgeBaseId": self.kb_id,
            "retrievalQuery": {"text": query},
            "retrievalConfiguration": {
                "vectorSearchConfiguration": {
                    "numberOfResults": num_results,
                    "filter": {"equals": {"key": "user_id", "value": user_id}},
                    "overrideSearchType": KB_SEARCH_TYPE,
                }
            },
        }

        # Run in executor to avoid blocking async loop
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None, lambda: self.bedrock_agent_runtime.retrieve(**retrieve_request)
        )

        results = []
        for result in response.get("retrievalResults", []):
            # Extract metadata from the result
            metadata = result.get("metadata", {})
            content = result.get("content", {}).get("text", "")
            score = result.get("score", 0)

            results.append(
                {
                    "session_id": metadata.get("session_id", ""),
                    "message_index": int(metadata.get("message_index", 0)),
                    "title": metadata.get("description", "Untitled Chat"),
                    "content": content,
                    "score": score,
                }
            )

        return results

    async def _rerank_results(
        self, query: str, results: List[Dict[str, Any]], limit: int
    ) -> List[Dict[str, Any]]:
        """Rerank results using Bedrock rerank model.

        Args:
            query: The original search query
            results: List of retrieval results to rerank
            limit: Maximum number of results to return after reranking

        Returns:
            Reranked list of results

        """
        if not results:
            return []

        # Build sources for reranking
        sources = [
            {
                "inlineDocumentSource": {
                    "textDocument": {"text": result.get("content", "")},
                    "type": "TEXT",
                },
                "type": "INLINE",
            }
            for result in results
        ]

        rerank_request = {
            "queries": [{"textQuery": {"text": query}, "type": "TEXT"}],
            "rerankingConfiguration": {
                "bedrockRerankingConfiguration": {
                    "modelConfiguration": {"modelArn": self.rerank_model_arn},
                    "numberOfResults": limit,
                },
                "type": "BEDROCK_RERANKING_MODEL",
            },
            "sources": sources,
        }

        try:
            # Run in executor to avoid blocking async loop
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(
                None, lambda: self.bedrock_agent_runtime.rerank(**rerank_request)
            )

            # Map reranked indices back to original results
            reranked = []
            for rerank_result in response.get("results", []):
                original_index = rerank_result.get("index", 0)
                if original_index < len(results):
                    result = results[original_index].copy()
                    result["score"] = rerank_result.get(
                        "relevanceScore", result.get("score", 0)
                    )
                    reranked.append(result)

            return reranked

        except Exception as e:
            logger.warning(f"Reranking failed, falling back to original order: {e}")
            # Fall back to original results if reranking fails
            return results[:limit]

    def _convert_to_search_results(
        self, results: List[Dict[str, Any]]
    ) -> List[SearchResult]:
        """Convert raw results to SearchResult objects.

        Args:
            results: List of result dictionaries

        Returns:
            List of SearchResult objects
        """
        return [
            SearchResult(
                session_id=result.get("session_id", ""),
                message_index=result.get("message_index", 0),
                title=result.get("title", "Untitled Chat"),
                content=result.get("content", ""),
                score=result.get("score", 0),
            )
            for result in results
        ]


# Global instance - initialized lazily based on environment
_kb_search_service: Optional[KBSearchService] = None


def get_kb_search_service() -> KBSearchService:
    """Get the global KB Search Service instance.

    Creates the instance on first call, using environment variables
    to configure the Knowledge Base and rerank model.

    Returns:
        The global KBSearchService instance
    """
    global _kb_search_service
    if _kb_search_service is None:
        _kb_search_service = KBSearchService()
    return _kb_search_service
