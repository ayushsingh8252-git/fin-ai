"""In-process registry of open interview WebSockets (api/interview.py's
/interview/ws/{session_id}), so work running outside the socket handler —
the speaker monitor's background task — can push events to the live
interview UI over the socket that's already open.

Single-process only: with several uvicorn workers a message only reaches
sockets held by the same worker. Fine for the current one-process
deployment; a Redis pub/sub fan-out would be needed before scaling out.
"""
import asyncio
import logging
import threading
from typing import Dict, Set, Tuple

logger = logging.getLogger(__name__)

_sockets: Dict[str, Set[Tuple[object, asyncio.AbstractEventLoop]]] = {}
_lock = threading.Lock()


def register(session_id: str, websocket, loop: asyncio.AbstractEventLoop) -> None:
    with _lock:
        _sockets.setdefault(session_id, set()).add((websocket, loop))


def unregister(session_id: str, websocket) -> None:
    with _lock:
        entries = _sockets.get(session_id)
        if not entries:
            return
        entries.difference_update({e for e in entries if e[0] is websocket})
        if not entries:
            _sockets.pop(session_id, None)


def publish(session_id: str, message: dict) -> int:
    """Thread-safe: callable from a worker thread. Returns how many sockets
    the message was handed to. A dead socket is dropped, never raised —
    a disconnected UI must not break the analysis that produced the event."""
    with _lock:
        targets = list(_sockets.get(session_id, ()))
    sent = 0
    for websocket, loop in targets:
        try:
            asyncio.run_coroutine_threadsafe(websocket.send_json(message), loop).result(timeout=5)
            sent += 1
        except Exception as e:
            logger.info("[interview_live] session=%s dropping dead socket: %s", session_id, e)
            unregister(session_id, websocket)
    return sent
