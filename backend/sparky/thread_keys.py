"""
Composite keys for Threads.

Threads need two distinct string keys derived from (session_id, thread_id),
each carrying a different meaning to a different subsystem:

  thread_stream_key    — key under which a thread's in-flight stream state
                         lives in `_active_streams`. Format chosen so a simple
                         `:thread:` substring lookup disambiguates thread
                         streams from plain session streams.

  thread_graph_id      — LangGraph `thread_id` used to namespace a thread's
                         own checkpoints. Note: we deliberately avoid
                         LangGraph's `checkpoint_ns` — it's reserved for
                         subgraphs and fails with "Subgraph X not found"
                         when set to an arbitrary value.

Keep both in this module so new format changes only need to be made once.
"""


def thread_stream_key(session_id: str, thread_id: str) -> str:
    return f"{session_id}::thread::{thread_id}"


def thread_graph_id_for(session_id: str, thread_id: str) -> str:
    return f"thread_{session_id}_{thread_id}"
