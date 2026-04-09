/**
 * TipTap Math Extension
 *
 * Renders LaTeX math in TipTap using KaTeX via ProseMirror decorations.
 * Supports inline ($...$) and display ($$...$$) math.
 * Click on rendered math to edit the raw LaTeX source.
 */

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import katex from "katex";

const MATH_KEY = new PluginKey("mathKatex");
const MATH_PATTERN = /\$\$(.+?)\$\$|\$([^$\n]+?)\$/;

/**
 * Find the math expression range containing the cursor position
 * by checking only the parent text node, not the entire document.
 */
function findEditingRange(doc, cursorPos) {
  const resolved = doc.resolve(cursorPos);
  const parent = resolved.parent;
  if (!parent || parent.childCount === 0) return null;

  // Find the text node containing the cursor
  let offset = resolved.start();
  for (let i = 0; i < parent.childCount; i++) {
    const child = parent.child(i);
    const childEnd = offset + child.nodeSize;
    if (cursorPos >= offset && cursorPos <= childEnd && child.isText && child.text) {
      const text = child.text;
      const regex = new RegExp(MATH_PATTERN.source, "g");
      let m;
      while ((m = regex.exec(text)) !== null) {
        const from = offset + m.index;
        const to = from + m[0].length;
        if (cursorPos >= from && cursorPos <= to) {
          return { from, to };
        }
      }
      return null; // Cursor is in this text node but not in a math expression
    }
    offset = childEnd;
  }
  return null;
}

function buildDecorations(doc, editingRange) {
  const decos = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;

    const text = node.text;
    const regex = new RegExp(MATH_PATTERN.source, "g");
    let m;

    while ((m = regex.exec(text)) !== null) {
      const isBlock = m[1] != null;
      const latex = (isBlock ? m[1] : m[2]).trim();
      if (!latex) continue;

      const from = pos + m.index;
      const to = from + m[0].length;

      // Skip decoration if this is the expression being edited
      if (editingRange && from === editingRange.from && to === editingRange.to) {
        continue;
      }

      let html;
      try {
        html = katex.renderToString(latex, {
          displayMode: isBlock,
          throwOnError: false,
        });
      } catch {
        continue;
      }

      decos.push(
        Decoration.inline(from, to, {
          style: "font-size:0;line-height:0;overflow:hidden;display:inline-block;width:0;height:0;",
        })
      );

      decos.push(
        Decoration.widget(
          from,
          () => {
            const tag = isBlock ? "div" : "span";
            const el = document.createElement(tag);
            el.className = isBlock ? "tiptap-math-block" : "tiptap-math-inline";
            el.contentEditable = "false";
            el.style.cursor = "pointer";
            el.innerHTML = html;
            return el;
          },
          { side: -1 }
        )
      );
    }
  });

  return DecorationSet.create(doc, decos);
}

const MathExtension = Extension.create({
  name: "mathKatex",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: MATH_KEY,
        state: {
          init(_, { doc }) {
            return { decos: buildDecorations(doc, null), editingRange: null };
          },
          apply(tr, old, oldState, newState) {
            const cursorPos = newState.selection.$from.pos;
            const editingRange = findEditingRange(newState.doc, cursorPos);

            // Only rebuild if doc changed or we entered/left a different math expression
            const oldFrom = old.editingRange?.from ?? null;
            const newFrom = editingRange?.from ?? null;
            if (tr.docChanged || oldFrom !== newFrom) {
              return { decos: buildDecorations(newState.doc, editingRange), editingRange };
            }
            return old;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state).decos;
          },
        },
      }),
    ];
  },
});

export default MathExtension;
