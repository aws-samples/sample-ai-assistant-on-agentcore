from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Iterator, Sequence
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import (
    BaseCheckpointSaver,
    ChannelVersions,
    Checkpoint,
    CheckpointMetadata,
    CheckpointTuple,
)
from langgraph.checkpoint.memory import InMemorySaver

logger = logging.getLogger(__name__)


class CachedCheckpointer(BaseCheckpointSaver[str]):
    """DynamoDB checkpointer with local InMemorySaver cache.

    - Reads: local cache -> primary (DynamoDB)
    - Writes: primary (DynamoDB) + local cache
    """

    def __init__(
        self,
        primary: BaseCheckpointSaver,
    ):
        super().__init__(serde=getattr(primary, "serde", None))
        self.primary = primary
        self.local = InMemorySaver(serde=getattr(primary, "serde", None))
        self._hydrated_sessions: set[tuple[str, str, str]] = set()
        self._prefetched_latest: dict[tuple[str, str, str], CheckpointTuple | None] = {}

    @property
    def config_specs(self):
        return list(self.primary.config_specs)

    def get_next_version(self, current: str | None, channel: None = None) -> str:
        return self.local.get_next_version(current, channel)

    # ── helpers ──

    def _cfg(self, config: RunnableConfig) -> dict[str, Any]:
        return config.get("configurable", {})

    def _session_key(self, config: RunnableConfig) -> tuple[str, str, str]:
        cfg = self._cfg(config)
        actor_id = cfg.get("actor_id", "")
        thread_id = cfg.get("thread_id")
        checkpoint_ns = cfg.get("checkpoint_ns", "") or ""
        if not thread_id:
            raise ValueError("Missing configurable.thread_id")
        return (str(actor_id), str(thread_id), str(checkpoint_ns))

    def _has_specific_checkpoint(self, config: RunnableConfig) -> bool:
        cfg = self._cfg(config)
        return bool(cfg.get("checkpoint_id"))

    def _mark_hydrated(self, key: tuple[str, str, str]) -> None:
        self._hydrated_sessions.add(key)

    def _clear_prefetch(self, key: tuple[str, str, str]) -> None:
        self._prefetched_latest.pop(key, None)

    # ── get_tuple (sync / async) ──

    def get_tuple(self, config: RunnableConfig) -> CheckpointTuple | None:
        key = self._session_key(config)

        if self._has_specific_checkpoint(config):
            local_tuple = self.local.get_tuple(config)
            if local_tuple is not None:
                return local_tuple
            return self.primary.get_tuple(config)

        if key in self._hydrated_sessions:
            local_tuple = self.local.get_tuple(config)
            if local_tuple is not None:
                return local_tuple

        if key in self._prefetched_latest:
            return self._prefetched_latest[key]

        primary_tuple = self.primary.get_tuple(config)
        self._prefetched_latest[key] = primary_tuple
        return primary_tuple

    async def aget_tuple(self, config: RunnableConfig) -> CheckpointTuple | None:
        key = self._session_key(config)

        if self._has_specific_checkpoint(config):
            local_tuple = await self.local.aget_tuple(config)
            if local_tuple is not None:
                return local_tuple
            return await self.primary.aget_tuple(config)

        if key in self._hydrated_sessions:
            local_tuple = await self.local.aget_tuple(config)
            if local_tuple is not None:
                return local_tuple

        if key in self._prefetched_latest:
            return self._prefetched_latest[key]

        primary_tuple = await self.primary.aget_tuple(config)
        self._prefetched_latest[key] = primary_tuple
        return primary_tuple

    # ── put (sync / async) — writes go to primary + local only ──

    def put(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> RunnableConfig:
        key = self._session_key(config)
        primary_config = self.primary.put(config, checkpoint, metadata, new_versions)
        local_config = self.local.put(config, checkpoint, metadata, new_versions)
        self._mark_hydrated(key)
        self._clear_prefetch(key)
        return local_config or primary_config

    async def aput(
        self,
        config: RunnableConfig,
        checkpoint: Checkpoint,
        metadata: CheckpointMetadata,
        new_versions: ChannelVersions,
    ) -> RunnableConfig:
        key = self._session_key(config)
        primary_config = await self.primary.aput(
            config, checkpoint, metadata, new_versions
        )
        local_config = await self.local.aput(config, checkpoint, metadata, new_versions)
        self._mark_hydrated(key)
        self._clear_prefetch(key)
        return local_config or primary_config

    # ── put_writes (sync / async) — writes go to primary + local only ──

    def put_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        key = self._session_key(config)
        self.primary.put_writes(config, writes, task_id, task_path)
        self.local.put_writes(config, writes, task_id, task_path)
        self._mark_hydrated(key)

    async def aput_writes(
        self,
        config: RunnableConfig,
        writes: Sequence[tuple[str, Any]],
        task_id: str,
        task_path: str = "",
    ) -> None:
        key = self._session_key(config)
        await self.primary.aput_writes(config, writes, task_id, task_path)
        await self.local.aput_writes(config, writes, task_id, task_path)
        self._mark_hydrated(key)

    # ── list (sync / async) ──

    def list(
        self,
        config: RunnableConfig | None,
        *,
        filter: dict[str, Any] | None = None,
        before: RunnableConfig | None = None,
        limit: int | None = None,
    ) -> Iterator[CheckpointTuple]:
        if config is None:
            yield from self.primary.list(
                config, filter=filter, before=before, limit=limit
            )
            return

        key = self._session_key(config)
        if key in self._hydrated_sessions:
            local_items = list(
                self.local.list(config, filter=filter, before=before, limit=limit)
            )
            if local_items:
                yield from local_items
                return

        yield from self.primary.list(config, filter=filter, before=before, limit=limit)

    async def alist(
        self,
        config: RunnableConfig | None,
        *,
        filter: dict[str, Any] | None = None,
        before: RunnableConfig | None = None,
        limit: int | None = None,
    ) -> AsyncIterator[CheckpointTuple]:
        if config is None:
            async for item in self.primary.alist(
                config, filter=filter, before=before, limit=limit
            ):
                yield item
            return

        key = self._session_key(config)
        if key in self._hydrated_sessions:
            found_any = False
            async for item in self.local.alist(
                config, filter=filter, before=before, limit=limit
            ):
                found_any = True
                yield item
            if found_any:
                return

        async for item in self.primary.alist(
            config, filter=filter, before=before, limit=limit
        ):
            yield item

    # ── delete / invalidate ──

    def delete_thread(self, thread_id: str) -> None:
        self.primary.delete_thread(thread_id)
        self.local.delete_thread(thread_id)
        to_remove = [k for k in self._hydrated_sessions if k[1] == thread_id]
        for k in to_remove:
            self._hydrated_sessions.discard(k)
            self._prefetched_latest.pop(k, None)

    async def adelete_thread(self, thread_id: str) -> None:
        await self.primary.adelete_thread(thread_id)
        await self.local.adelete_thread(thread_id)
        to_remove = [k for k in self._hydrated_sessions if k[1] == thread_id]
        for k in to_remove:
            self._hydrated_sessions.discard(k)
            self._prefetched_latest.pop(k, None)

    def invalidate_session(
        self, actor_id: str, thread_id: str, checkpoint_ns: str = ""
    ) -> None:
        key = (str(actor_id), str(thread_id), str(checkpoint_ns or ""))
        self._hydrated_sessions.discard(key)
        self._prefetched_latest.pop(key, None)

    async def aprefetch_session(
        self, actor_id: str, thread_id: str, checkpoint_ns: str = ""
    ) -> None:
        """Pre-warm the prefetch cache from primary (DynamoDB)."""
        key = (str(actor_id), str(thread_id), str(checkpoint_ns or ""))
        if key in self._hydrated_sessions or key in self._prefetched_latest:
            return

        config: RunnableConfig = {
            "configurable": {
                "actor_id": actor_id,
                "thread_id": thread_id,
                "checkpoint_ns": checkpoint_ns,
            }
        }
        try:
            primary_tuple = await self.primary.aget_tuple(config)
            self._prefetched_latest[key] = primary_tuple
        except Exception as e:
            logger.warning(
                "[CachedCheckpointer] prefetch failed for key=%s: %s",
                key,
                e,
            )

    async def acopy_checkpoint_ns(
        self,
        src_actor_id: str,
        src_thread_id: str,
        src_ns: str,
        dst_actor_id: str,
        dst_thread_id: str,
        dst_ns: str,
    ) -> int:
        """Copy every checkpoint under (src_actor_id, src_thread_id, src_ns)
        into (dst_actor_id, dst_thread_id, dst_ns).

        Used when branching a session — each thread_anchor on the source
        session points at a namespaced sub-conversation whose checkpoints
        must be carried over to the new session.

        Returns the number of checkpoints copied.
        """
        src_config: RunnableConfig = {
            "configurable": {
                "actor_id": src_actor_id,
                "thread_id": src_thread_id,
                "checkpoint_ns": src_ns,
            }
        }

        collected: list[CheckpointTuple] = []
        async for cp_tuple in self.primary.alist(src_config):
            collected.append(cp_tuple)

        # alist yields newest → oldest; replay oldest → newest so parent_config
        # references remain valid in the destination.
        collected.reverse()

        copied = 0
        for cp_tuple in collected:
            dst_config: RunnableConfig = {
                "configurable": {
                    "actor_id": dst_actor_id,
                    "thread_id": dst_thread_id,
                    "checkpoint_ns": dst_ns,
                }
            }
            try:
                await self.primary.aput(
                    dst_config,
                    cp_tuple.checkpoint,
                    cp_tuple.metadata or {},
                    {},
                )
                copied += 1
            except Exception as e:
                logger.warning(
                    "[CachedCheckpointer] acopy_checkpoint_ns: failed to put "
                    "checkpoint id=%s to dst=%s: %s",
                    cp_tuple.checkpoint.get("id"),
                    (dst_actor_id, dst_thread_id, dst_ns),
                    e,
                )

        # Destination has fresh state — clear any stale cached data for its key.
        self.invalidate_session(dst_actor_id, dst_thread_id, dst_ns)
        return copied
