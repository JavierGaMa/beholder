import { describe, expect, it } from "vitest";
import { buildMcpSnippets } from "./agentSnippets";
import {
  SNIPPET_TAB_IDS,
  lastSnippetTab,
  nextSnippetTab,
  rememberSnippetTab,
} from "./snippetTabs";

const SNIPPET_INPUT = {
  command: "/opt/beholder/bin/beholder-mcp",
  discoveryPath: "/Users/dev/.beholder/agent.json",
};

describe("snippet tab model", () => {
  it("lists the client tabs in display order", () => {
    expect([...SNIPPET_TAB_IDS]).toEqual([
      "generic",
      "claude-code",
      "cursor",
      "opencode",
    ]);
  });

  it("matches the ids of the generated snippets", () => {
    expect([...SNIPPET_TAB_IDS]).toEqual(
      buildMcpSnippets(SNIPPET_INPUT).map((s) => s.id),
    );
  });
});

describe("nextSnippetTab", () => {
  it("moves right and left through the tabs", () => {
    expect(nextSnippetTab("generic", "ArrowRight")).toBe("claude-code");
    expect(nextSnippetTab("cursor", "ArrowRight")).toBe("opencode");
    expect(nextSnippetTab("cursor", "ArrowLeft")).toBe("claude-code");
  });

  it("wraps in both directions", () => {
    expect(nextSnippetTab("opencode", "ArrowRight")).toBe("generic");
    expect(nextSnippetTab("generic", "ArrowLeft")).toBe("opencode");
  });

  it("accepts vertical arrows as synonyms", () => {
    expect(nextSnippetTab("cursor", "ArrowDown")).toBe("opencode");
    expect(nextSnippetTab("cursor", "ArrowUp")).toBe("claude-code");
  });

  it("jumps to the ends with Home and End", () => {
    expect(nextSnippetTab("cursor", "Home")).toBe("generic");
    expect(nextSnippetTab("cursor", "End")).toBe("opencode");
  });

  it("returns the current tab for unrelated keys", () => {
    expect(nextSnippetTab("cursor", "Enter")).toBe("cursor");
    expect(nextSnippetTab("cursor", "a")).toBe("cursor");
  });
});

describe("snippet tab persistence", () => {
  it("returns null before any tab is remembered", () => {
    expect(lastSnippetTab()).toBeNull();
  });

  it("remembers the last selected tab in session state", () => {
    rememberSnippetTab("opencode");
    expect(lastSnippetTab()).toBe("opencode");
    rememberSnippetTab("generic");
    expect(lastSnippetTab()).toBe("generic");
  });
});
