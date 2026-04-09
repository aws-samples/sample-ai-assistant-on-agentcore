"""AWS AgentCore Browser tool client.

Manages browser session lifecycle (create, interact, close) using the
bedrock_agentcore SDK's BrowserClient for session management and SigV4
header signing, and Playwright for CDP-based browser interactions.
"""

import base64
import logging
import os
import uuid

from bedrock_agentcore.tools.browser_client import (
    BrowserClient as AgentCoreBrowserClient,
)
from playwright.async_api import async_playwright

from config import REGION

logger = logging.getLogger(__name__)

BROWSER_TOOL_ID = os.environ.get("BROWSER_TOOL_ID", "aws.browser.v1")

# Keep these aligned with your frontend viewer box for consistent “fit” behavior.
VIEWPORT_WIDTH = int(os.environ.get("BROWSER_VIEWPORT_WIDTH", "800"))
VIEWPORT_HEIGHT = int(os.environ.get("BROWSER_VIEWPORT_HEIGHT", "600"))


class BrowserToolError(Exception):
    """Raised when a Browser tool operation fails."""

    pass


class BrowserClient:
    """Client for managing AgentCore Browser sessions."""

    def __init__(self, region: str):
        self.region = region
        self._sessions: dict[str, dict] = {}
        self._agentcore_clients: dict[str, AgentCoreBrowserClient] = {}
        self._browser_to_session: dict[str, str] = {}  # browser_session_id → session_id
        self._playwright = None
        self._browsers: dict[str, object] = {}
        self._contexts: dict[str, object] = {}  # NEW: store context per session
        self._pages: dict[str, object] = {}  # NEW: store page per session

    async def _ensure_playwright(self):
        if self._playwright is None:
            self._playwright = await async_playwright().start()
        return self._playwright

    async def get_or_create_session(self, session_id: str) -> dict:
        """Get cached or create new browser session."""
        if session_id in self._sessions:
            return self._sessions[session_id]

        try:
            ac_client = AgentCoreBrowserClient(region=self.region)

            # Keep your existing start call (1.4.2 helper may not expose viewPort).
            ac_client.start(
                identifier=BROWSER_TOOL_ID,
                session_timeout_seconds=1800,
            )

            browser_session_id = ac_client.session_id
            ws_url, headers = ac_client.generate_ws_headers()

            session_info = {
                "browser_session_id": browser_session_id,
                "url_lifetime": 300,
                "viewport": {"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT},
                "user_controlled": False,
                "lock_id": None,
            }

            self._sessions[session_id] = session_info
            self._agentcore_clients[session_id] = ac_client
            self._browser_to_session[browser_session_id] = session_id

            logger.debug(
                f"Created browser session {browser_session_id} for session {session_id}"
            )

            await self._connect_playwright(session_id, ws_url, headers)
            return session_info
        except BrowserToolError:
            raise
        except Exception as e:
            logger.error(f"Failed to create browser session: {e}")
            raise BrowserToolError(f"Failed to create browser session: {e}") from e

    async def generate_live_view_url(self, browser_session_id: str) -> dict:
        """Generate a fresh live view URL for an existing browser session."""
        session_id = self._browser_to_session.get(browser_session_id)
        if not session_id:
            raise BrowserToolError(
                f"No active browser session for session {browser_session_id}"
            )
        ac_client = self._agentcore_clients.get(session_id)
        if not ac_client:
            raise BrowserToolError(
                f"No active browser session for session {browser_session_id}"
            )
        try:
            url = ac_client.generate_live_view_url(expires=300)
            return {"live_view_url": url, "url_lifetime": 300}
        except Exception as e:
            raise BrowserToolError(f"Failed to generate live view URL: {e}") from e

    async def _connect_playwright(self, session_id: str, ws_url: str, headers: dict):
        """Connect Playwright to the browser via signed CDP WebSocket."""
        try:
            pw = await self._ensure_playwright()
            browser = await pw.chromium.connect_over_cdp(
                endpoint_url=ws_url,
                headers=headers,
                timeout=30000,
            )
            self._browsers[session_id] = browser

            # NEW: create a single stable context/page with known viewport
            contexts = browser.contexts
            context = (
                contexts[0]
                if contexts
                else await browser.new_context(
                    viewport={"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT}
                )
            )
            page = context.pages[0] if context.pages else await context.new_page()

            self._contexts[session_id] = context
            self._pages[session_id] = page

            logger.debug(f"Playwright connected to session {session_id}")
        except Exception as e:
            logger.error(f"Failed to connect Playwright: {e}")
            raise BrowserToolError(
                f"Failed to connect Playwright to browser session: {e}"
            ) from e

    async def _get_page(self, session_id: str):
        """Get or create a page for the session, reconnecting if needed."""
        page = self._pages.get(session_id)
        browser = self._browsers.get(session_id)

        if page and browser and browser.is_connected():
            return page

        # Reconnect if needed (preserves your original behavior)
        browser = self._browsers.get(session_id)
        if not browser or not browser.is_connected():
            ac_client = self._agentcore_clients.get(session_id)
            if ac_client:
                logger.info(f"Reconnecting Playwright for session {session_id}")
                ws_url, headers = ac_client.generate_ws_headers()
                await self._connect_playwright(session_id, ws_url, headers)
                browser = self._browsers.get(session_id)
            if not browser:
                raise BrowserToolError(
                    f"No Playwright connection for session {session_id}"
                )

        # NEW: after reconnect, return cached page
        page = self._pages.get(session_id)
        if page:
            return page

        # Fallback: keep your old logic (should rarely hit now)
        contexts = browser.contexts
        if contexts and contexts[0].pages:
            return contexts[0].pages[0]

        context = (
            contexts[0]
            if contexts
            else await browser.new_context(
                viewport={"width": VIEWPORT_WIDTH, "height": VIEWPORT_HEIGHT}
            )
        )
        page = await context.new_page()
        self._contexts[session_id] = context
        self._pages[session_id] = page
        return page

    async def invoke_browser(self, session_id: str, action: str, **params) -> dict:
        """Execute a browser action."""
        try:
            page = await self._get_page(session_id)
            handler = getattr(self, f"_action_{action}", None)
            if handler is None:
                return {
                    "status": "error",
                    "content": f"Unknown action: {action}. Supported: navigate, click, type, "
                    "press_key, scroll, hover, screenshot, get_text, wait, go_back, go_forward",
                }
            return await handler(page, **params)
        except Exception as e:
            logger.error(f"Browser action '{action}' failed: {e}")
            return {"status": "error", "content": str(e)}

    # ── Action handlers ──────────────────────────────────────────────

    async def _action_navigate(self, page, url: str = "", **_) -> dict:
        if not url:
            return {"status": "error", "content": "url is required for navigate"}
        logger.info(f"Navigating to {url}")
        await page.goto(url, wait_until="domcontentloaded", timeout=30000)
        title = await page.title()
        text = await page.evaluate(
            "() => document.body ? document.body.innerText.substring(0, 8000) : ''"
        )
        return {"status": "success", "content": f"Title: {title}\n\n{text}", "url": url}

    async def _action_click(
        self, page, x: int = 0, y: int = 0, selector: str = "", **_
    ) -> dict:
        if selector:
            await page.click(selector, timeout=5000)
            return {"status": "success", "content": f"Clicked selector: {selector}"}
        await page.mouse.click(x, y)
        return {"status": "success", "content": f"Clicked at ({x}, {y})"}

    async def _action_type(self, page, text: str = "", selector: str = "", **_) -> dict:
        if not text:
            return {"status": "error", "content": "text is required for type"}
        if selector:
            await page.fill(selector, text, timeout=5000)
            return {"status": "success", "content": f"Typed into {selector}"}
        await page.keyboard.type(text)
        return {"status": "success", "content": f"Typed: {text[:100]}"}

    async def _action_press_key(self, page, key: str = "", **_) -> dict:
        if not key:
            return {"status": "error", "content": "key is required for press_key"}
        await page.keyboard.press(key)
        return {"status": "success", "content": f"Pressed key: {key}"}

    async def _action_scroll(
        self, page, x: int = 0, y: int = 0, delta_x: int = 0, delta_y: int = 0, **_
    ) -> dict:
        if not delta_x and not delta_y:
            delta_y = -300
        await page.mouse.wheel(delta_x, delta_y)
        return {
            "status": "success",
            "content": f"Scrolled ({delta_x}, {delta_y}) at ({x}, {y})",
        }

    async def _action_hover(
        self, page, x: int = 0, y: int = 0, selector: str = "", **_
    ) -> dict:
        if selector:
            await page.hover(selector, timeout=5000)
            return {"status": "success", "content": f"Hovered over {selector}"}
        await page.mouse.move(x, y)
        return {"status": "success", "content": f"Mouse moved to ({x}, {y})"}

    async def _action_screenshot(self, page, **_) -> dict:
        buf = await page.screenshot(type="png")
        b64 = base64.b64encode(buf).decode("utf-8")
        return {
            "status": "success",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": b64,
                    },
                }
            ],
        }

    async def _action_get_text(self, page, **_) -> dict:
        title = await page.title()
        url = page.url
        text = await page.evaluate(
            "() => document.body ? document.body.innerText.substring(0, 8000) : ''"
        )
        return {"status": "success", "content": f"URL: {url}\nTitle: {title}\n\n{text}"}

    async def _action_wait(
        self, page, selector: str = "", timeout: int = 3000, **_
    ) -> dict:
        if selector:
            await page.wait_for_selector(selector, timeout=timeout)
            return {"status": "success", "content": f"Element '{selector}' found"}
        await page.wait_for_timeout(timeout)
        return {"status": "success", "content": f"Waited {timeout}ms"}

    async def _action_go_back(self, page, **_) -> dict:
        await page.go_back(wait_until="domcontentloaded", timeout=10000)
        title = await page.title()
        return {
            "status": "success",
            "content": f"Navigated back. Title: {title}",
            "url": page.url,
        }

    async def _action_go_forward(self, page, **_) -> dict:
        await page.go_forward(wait_until="domcontentloaded", timeout=10000)
        title = await page.title()
        return {
            "status": "success",
            "content": f"Navigated forward. Title: {title}",
            "url": page.url,
        }

    async def close_session(self, session_id: str) -> dict | None:
        """Close browser session and clean up all resources."""
        session_info = self._sessions.pop(session_id, None)

        # Clean up reverse mapping
        if session_info:
            self._browser_to_session.pop(session_info.get("browser_session_id"), None)

        # NEW: close cached page/context first
        page = self._pages.pop(session_id, None)
        if page:
            try:
                await page.close()
            except Exception:
                pass

        context = self._contexts.pop(session_id, None)
        if context:
            try:
                await context.close()
            except Exception:
                pass

        browser = self._browsers.pop(session_id, None)
        if browser:
            try:
                await browser.close()
            except Exception as e:
                logger.warning(f"Failed to close Playwright browser: {e}")

        ac_client = self._agentcore_clients.pop(session_id, None)
        if ac_client:
            try:
                ac_client.stop()
            except Exception as e:
                logger.warning(f"Failed to stop AgentCore browser session: {e}")

        return session_info

    def set_user_controlled(self, session_id: str) -> str:
        """Lock the session for user control.

        Generates and stores a random UUID lock_id, sets user_controlled=True.
        Returns the lock_id. Raises BrowserToolError if session not found.
        """
        if session_id not in self._sessions:
            raise BrowserToolError(f"Session not found: {session_id}")
        lock_id = str(uuid.uuid4())
        self._sessions[session_id]["user_controlled"] = True
        self._sessions[session_id]["lock_id"] = lock_id
        return lock_id

    def release_user_controlled(self, session_id: str, lock_id: str) -> bool:
        """Release user control if the provided lock_id matches the stored one.

        Returns True if released, False if lock_id didn't match (idempotent no-op).
        Raises BrowserToolError if session not found.
        """
        if session_id not in self._sessions:
            raise BrowserToolError(f"Session not found: {session_id}")
        stored_lock_id = self._sessions[session_id].get("lock_id")
        if stored_lock_id != lock_id:
            return False
        self._sessions[session_id]["user_controlled"] = False
        self._sessions[session_id]["lock_id"] = None
        return True

    def clear_user_controlled(self, session_id: str) -> None:
        """Force-clear user control (used on timeout). No lock_id check.

        Raises BrowserToolError if session not found.
        """
        if session_id not in self._sessions:
            raise BrowserToolError(f"Session not found: {session_id}")
        self._sessions[session_id]["user_controlled"] = False
        self._sessions[session_id]["lock_id"] = None

    def is_user_controlled(self, session_id: str) -> bool:
        """Return current user_controlled flag.

        Raises BrowserToolError if session not found.
        """
        if session_id not in self._sessions:
            raise BrowserToolError(f"Session not found: {session_id}")
        return self._sessions[session_id].get("user_controlled", False)

    def get_lock_id(self, session_id: str) -> str | None:
        """Return current lock_id for the session.

        Raises BrowserToolError if session not found.
        """
        if session_id not in self._sessions:
            raise BrowserToolError(f"Session not found: {session_id}")
        return self._sessions[session_id].get("lock_id")


# Module-level singleton
browser_client = BrowserClient(region=REGION)
