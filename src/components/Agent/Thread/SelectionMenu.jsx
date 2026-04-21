import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MessageCirclePlus } from "lucide-react";
import { ChatSessionDataContext, ChatSessionFunctionsContext } from "../ChatContext";
import { THREAD_DRAFT_ID } from "../useChatSessionFunctions";

/**
 * Wraps an AI message's text block. When the user highlights text inside it,
 * a small floating "Ask Sparky" button appears above the selection. Clicking
 * it opens the thread drawer in draft mode — the thread isn't created until
 * the user actually sends a message.
 *
 * Native right-click is preserved (no Radix ContextMenu).
 */
export default function SelectionMenu({
  children,
  enabled = true,
  textSource,
  turnIndex,
  aiMessageIndex = 0,
  sessionId,
  messageId = null,
}) {
  const wrapperRef = useRef(null);
  const data = useContext(ChatSessionDataContext);
  const functions = useContext(ChatSessionFunctionsContext);
  const [buttonPos, setButtonPos] = useState(null);
  const [selection, setSelection] = useState(null);

  // Anchors for inline highlighting
  const turnAnchors = useMemo(() => {
    if (!sessionId || typeof turnIndex !== "number") return [];
    const session = data?.sessions?.get(sessionId);
    const anchors = session?.threadAnchors;
    if (!anchors || anchors.size === 0) return [];
    const out = [];
    for (const a of anchors.values()) {
      if (a.turn_index === turnIndex && a.quoted_text) out.push(a);
    }
    return out;
  }, [data, sessionId, turnIndex]);

  const anchorsSignature = useMemo(
    () =>
      turnAnchors
        .map((a) => `${a.thread_id}::${a.quoted_text}`)
        .sort()
        .join("||"),
    [turnAnchors]
  );

  const openThread = useCallback(
    (threadId) => {
      functions?.setActiveThread?.(sessionId, threadId);
    },
    [functions, sessionId]
  );

  // ── Inline anchor highlighting ──────────────────────────────────
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || turnAnchors.length === 0) return undefined;

    const MARKER_ATTR = "data-thread-anchor";
    const anchors = [...turnAnchors].sort((a, b) => b.quoted_text.length - a.quoted_text.length);
    const wrappedNodes = [];

    const collectTextNodes = () => {
      const walker = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          let p = node.parentElement;
          while (p && p !== wrapper) {
            if (p.hasAttribute?.(MARKER_ATTR)) return NodeFilter.FILTER_REJECT;
            p = p.parentElement;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const nodes = [];
      let n;
      while ((n = walker.nextNode())) nodes.push(n);
      return nodes;
    };

    const wrapRangeAcrossNodes = (nodes, globalStart, globalEnd, anchor) => {
      const doc = wrapper.ownerDocument;
      let cursor = 0;
      for (const node of nodes) {
        const nodeStart = cursor;
        const nodeEnd = cursor + node.data.length;
        cursor = nodeEnd;
        if (nodeEnd <= globalStart) continue;
        if (nodeStart >= globalEnd) break;
        const localStart = Math.max(0, globalStart - nodeStart);
        const localEnd = Math.min(node.data.length, globalEnd - nodeStart);
        if (localEnd <= localStart) continue;
        const rangeNode = localStart === 0 ? node : node.splitText(localStart);
        if (localEnd - localStart < rangeNode.data.length) {
          rangeNode.splitText(localEnd - localStart);
        }
        const span = doc.createElement("span");
        span.setAttribute(MARKER_ATTR, anchor.thread_id);
        span.className = "thread-anchor-inline";
        span.title = `Open thread`;
        span.textContent = rangeNode.data;
        rangeNode.replaceWith(span);
        wrappedNodes.push(span);
      }
    };

    const buildNormalized = (raw) => {
      let out = "";
      const map = [];
      let prevWasSpace = false;
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        const isSpace = /\s/.test(ch);
        if (isSpace) {
          if (prevWasSpace) continue;
          out += " ";
          map.push(i);
          prevWasSpace = true;
        } else {
          out += ch;
          map.push(i);
          prevWasSpace = false;
        }
      }
      return { text: out.trim(), map };
    };

    for (const anchor of anchors) {
      const quote = anchor.quoted_text;
      if (!quote || quote.length < 2) continue;
      const nodes = collectTextNodes();
      if (nodes.length === 0) continue;
      const raw = nodes.map((n) => n.data).join("");
      const { text: normRaw, map } = buildNormalized(raw);
      const { text: normQuote } = buildNormalized(quote);
      if (!normQuote) continue;
      const hit = normRaw.indexOf(normQuote);
      if (hit < 0) continue;
      const rawStart = map[hit];
      const endMapIdx = hit + normQuote.length - 1;
      const rawEnd = endMapIdx < map.length ? map[endMapIdx] + 1 : raw.length;
      wrapRangeAcrossNodes(nodes, rawStart, rawEnd, anchor);
    }

    const onClick = (e) => {
      const target = e.target.closest?.(`[${MARKER_ATTR}]`);
      if (!target || !wrapper.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      openThread(target.getAttribute(MARKER_ATTR));
    };

    const onHover = (e) => {
      const target = e.target.closest?.(`[${MARKER_ATTR}]`);
      if (!target || !wrapper.contains(target)) return;
      const tid = target.getAttribute(MARKER_ATTR);
      wrapper
        .querySelectorAll(`[${MARKER_ATTR}="${CSS.escape(tid)}"]`)
        .forEach((el) => el.classList.add("thread-anchor-hover"));
    };
    const onUnhover = (e) => {
      const target = e.target.closest?.(`[${MARKER_ATTR}]`);
      if (!target || !wrapper.contains(target)) return;
      const related = e.relatedTarget?.closest?.(`[${MARKER_ATTR}]`);
      const tid = target.getAttribute(MARKER_ATTR);
      if (related && related.getAttribute(MARKER_ATTR) === tid) return;
      wrapper
        .querySelectorAll(`[${MARKER_ATTR}="${CSS.escape(tid)}"]`)
        .forEach((el) => el.classList.remove("thread-anchor-hover"));
    };

    wrapper.addEventListener("click", onClick);
    wrapper.addEventListener("mouseover", onHover);
    wrapper.addEventListener("mouseout", onUnhover);

    return () => {
      wrapper.removeEventListener("click", onClick);
      wrapper.removeEventListener("mouseover", onHover);
      wrapper.removeEventListener("mouseout", onUnhover);
      for (const span of wrappedNodes) {
        if (!span.parentNode) continue;
        const textNode = span.ownerDocument.createTextNode(span.textContent);
        span.parentNode.replaceChild(textNode, span);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchorsSignature, textSource, openThread]);

  // Selectionchange fires for every cursor tick anywhere in the document,
  // including typing in other inputs. Bail out before any DOM work when the
  // selection isn't in this wrapper. Coalesce bursts with rAF and skip state
  // updates if the captured selection hasn't changed.
  useEffect(() => {
    if (!enabled) return undefined;
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;

    let rafId = null;
    let lastQuoted = null;

    const clear = () => {
      lastQuoted = null;
      setButtonPos((prev) => (prev === null ? prev : null));
      setSelection((prev) => (prev === null ? prev : null));
    };

    const compute = () => {
      rafId = null;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) return clear();
      if (!wrapper.contains(sel.anchorNode)) return clear();
      const range = sel.getRangeAt(0);
      // Chrome's triple-click / select-all often pushes endContainer to the
      // start of the next sibling — outside this wrapper. Clip instead of
      // bailing so the button still appears.
      const clipped = range.cloneRange();
      if (!wrapper.contains(clipped.startContainer)) {
        clipped.setStart(wrapper, 0);
      }
      if (!wrapper.contains(clipped.endContainer)) {
        clipped.setEndAfter(wrapper.lastChild || wrapper);
      }
      const quoted = clipped.toString();
      if (!quoted.trim()) return clear();
      if (quoted === lastQuoted) return;
      lastQuoted = quoted;

      const rect = clipped.getBoundingClientRect();
      const wrapperText = wrapper.innerText || wrapper.textContent || "";
      const startOffset = wrapperText.indexOf(quoted);
      const endOffset = startOffset >= 0 ? startOffset + quoted.length : -1;

      setButtonPos({ top: rect.top - 36, left: rect.left + rect.width / 2 });
      setSelection({ quoted, startOffset, endOffset, rect });
    };

    const onSelectionChange = () => {
      // Fast path: if the selection clearly isn't in this wrapper, don't
      // even schedule a rAF.
      const sel = window.getSelection();
      if (!sel || !sel.anchorNode || !wrapper.contains(sel.anchorNode)) {
        if (lastQuoted !== null) clear();
        return;
      }
      if (rafId != null) return;
      rafId = requestAnimationFrame(compute);
    };

    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", onSelectionChange);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, [enabled]);

  const handleAskSparky = useCallback(() => {
    if (!selection || !functions) return;
    functions.setDraftThread(sessionId, {
      turnIndex,
      aiMessageIndex,
      quotedText: selection.quoted,
      startOffset: selection.startOffset,
      endOffset: selection.endOffset,
      messageId,
    });
    functions.setActiveThread(sessionId, THREAD_DRAFT_ID);
    setButtonPos(null);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  }, [selection, functions, sessionId, turnIndex, aiMessageIndex, messageId]);

  return (
    <>
      <div ref={wrapperRef} style={{ cursor: "text" }}>
        {children}
      </div>
      {buttonPos &&
        enabled &&
        createPortal(
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              handleAskSparky();
            }}
            className="thread-ask-button"
            style={{
              position: "fixed",
              top: buttonPos.top,
              left: buttonPos.left,
              transform: "translateX(-50%)",
              zIndex: 100,
            }}
          >
            <MessageCirclePlus className="h-3.5 w-3.5" />
            Ask Sparky
          </button>,
          document.body
        )}
    </>
  );
}
