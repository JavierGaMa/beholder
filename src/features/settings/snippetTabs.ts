import { nextMenuIndex } from "../../components/ui/menuNav";

export const SNIPPET_TAB_IDS = [
  "generic",
  "claude-code",
  "cursor",
  "opencode",
] as const;

export type SnippetTabId = (typeof SNIPPET_TAB_IDS)[number];

export function nextSnippetTab(current: SnippetTabId, key: string): SnippetTabId {
  const normalized =
    key === "ArrowRight" ? "ArrowDown" : key === "ArrowLeft" ? "ArrowUp" : key;
  const ids = [...SNIPPET_TAB_IDS];
  const next = nextMenuIndex(normalized, ids.indexOf(current), ids.map(() => true));
  return ids[next] ?? current;
}

let remembered: SnippetTabId | null = null;

export function rememberSnippetTab(id: SnippetTabId): void {
  remembered = id;
}

export function lastSnippetTab(): SnippetTabId | null {
  return remembered;
}
