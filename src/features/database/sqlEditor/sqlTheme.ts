import { EditorView } from "@uiw/react-codemirror";
import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

export const sqlEditorTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--surface)",
    color: "var(--txt)",
    height: "100%",
    fontSize: "var(--mono-size)",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
  },
  ".cm-scroller": {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "var(--mono-size)",
    lineHeight: "1.625",
    overflow: "auto",
  },
  ".cm-content": {
    caretColor: "var(--accent)",
    padding: "8px 12px",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--accent)",
    borderLeftWidth: "2px",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": {
    backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete": {
    backgroundColor: "var(--surface-2)",
    border: "1px solid var(--line)",
    borderRadius: "6px",
    boxShadow: "0 8px 24px rgb(0 0 0 / 0.35)",
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: "var(--mono-size)",
    color: "var(--txt)",
    overflow: "hidden",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    padding: "2px 6px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "color-mix(in srgb, var(--accent) 25%, transparent)",
    color: "var(--txt)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete .cm-completionIcon": {
    color: "var(--muted)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete .cm-completionDetail": {
    color: "var(--muted)",
    fontStyle: "normal",
  },
});

export const sqlHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--accent)" },
  { tag: tags.string, color: "var(--ok)" },
  { tag: tags.number, color: "var(--warn)" },
  { tag: tags.comment, color: "var(--muted)" },
  { tag: tags.operator, color: "var(--muted)" },
]);
