"""Citation formatting helpers for Claude native citations."""

import html


def build_citation_markers(citations: list) -> str:
    """Build citation markers from citations array.

    Used when citation chunks arrive with empty text (streaming).
    Includes document title, page numbers, and source text preview.
    """
    if not citations:
        return ""

    markers = []
    for idx, cite in enumerate(citations):
        doc_title = cite.get("title", "Document")
        location = cite.get("location", {})
        doc_page = location.get("document_page", {})
        start_page = doc_page.get("start")
        end_page = doc_page.get("end")

        if start_page is not None and end_page is not None:
            page_str = (
                f"p.{start_page}"
                if start_page == end_page
                else f"pp.{start_page}-{end_page}"
            )
        elif start_page is not None:
            page_str = f"p.{start_page}"
        else:
            page_str = ""

        source_text = ""
        source_content = cite.get("source_content", [])
        if source_content and len(source_content) > 0:
            full_text = source_content[0].get("text", "")
            source_text = " ".join(full_text.split())[:100]
            if len(full_text) > 100:
                source_text += "..."
            source_text = html.escape(source_text, quote=True)

        markers.append(
            f'<cite data-doc="{html.escape(doc_title, quote=True)}" data-pages="{html.escape(page_str, quote=True)}" data-text="{source_text}">[{idx + 1}]</cite> '
        )

    return "".join(markers)


def inject_citation_tags(text: str, citations: list) -> str:
    """Append citation markers to text based on Claude's citation format."""
    if not citations or not text:
        return text

    citation_markers = []
    for idx, cite in enumerate(citations):
        doc_title = cite.get("title", "Document")
        location = cite.get("location", {})
        doc_page = location.get("document_page", {})
        start_page = doc_page.get("start")
        end_page = doc_page.get("end")

        if start_page is not None and end_page is not None:
            page_str = (
                f"p.{start_page}"
                if start_page == end_page
                else f"pp.{start_page}-{end_page}"
            )
        elif start_page is not None:
            page_str = f"p.{start_page}"
        else:
            page_str = ""

        citation_markers.append(
            f'<cite data-doc="{html.escape(doc_title, quote=True)}" data-pages="{html.escape(page_str, quote=True)}">[{idx + 1}]</cite> '
        )

    if citation_markers:
        return text + " " + "".join(citation_markers)
    return text
