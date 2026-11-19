import { describe, expect, it } from "vitest";
import { buildMcpSnippets, tokenHandlingNote } from "./agentSnippets";

const INPUT = {
  command: "/opt/beholder/bin/beholder-mcp",
  discoveryPath: "/Users/dev/.beholder/agent.json",
};

describe("buildMcpSnippets", () => {
  it("returns generic, claude-code, cursor and opencode variants", () => {
    const ids = buildMcpSnippets(INPUT).map((s) => s.id);
    expect(ids).toEqual(["generic", "claude-code", "cursor", "opencode"]);
  });

  it("gives every variant a label, filename, note and code block", () => {
    for (const snippet of buildMcpSnippets(INPUT)) {
      expect(snippet.label.length).toBeGreaterThan(0);
      expect(snippet.filename.length).toBeGreaterThan(0);
      expect(snippet.note.length).toBeGreaterThan(0);
      expect(snippet.code.length).toBeGreaterThan(0);
    }
  });

  it("plugs the real sidecar command into mcpServers entries", () => {
    for (const id of ["generic", "claude-code", "cursor"]) {
      const snippet = buildMcpSnippets(INPUT).find((s) => s.id === id);
      const parsed = JSON.parse(snippet!.code) as {
        mcpServers: Record<string, { command: string }>;
      };
      expect(parsed.mcpServers.beholder.command).toBe(INPUT.command);
    }
  });

  it("formats the opencode variant with its local command array", () => {
    const snippet = buildMcpSnippets(INPUT).find((s) => s.id === "opencode");
    const parsed = JSON.parse(snippet!.code) as {
      mcp: Record<string, { type: string; command: string[] }>;
    };
    expect(parsed.mcp.beholder.type).toBe("local");
    expect(parsed.mcp.beholder.command[0]).toBe(INPUT.command);
  });

  it("emits pretty-printed two-space JSON", () => {
    const generic = buildMcpSnippets(INPUT).find((s) => s.id === "generic");
    expect(generic!.code).toBe(
      JSON.stringify(
        { mcpServers: { beholder: { command: INPUT.command } } },
        null,
        2,
      ),
    );
  });

  it("never embeds a token field in any snippet code", () => {
    for (const snippet of buildMcpSnippets(INPUT)) {
      const parsed: unknown = JSON.parse(snippet.code);
      const stack: unknown[] = [parsed];
      while (stack.length > 0) {
        const node = stack.pop();
        if (Array.isArray(node)) {
          stack.push(...node);
        } else if (node && typeof node === "object") {
          for (const [key, value] of Object.entries(node)) {
            expect(key).not.toBe("token");
            stack.push(value);
          }
        }
      }
    }
  });
});

describe("tokenHandlingNote", () => {
  it("points at the discovery file and its permissions", () => {
    const note = tokenHandlingNote(INPUT.discoveryPath);
    expect(note).toContain(INPUT.discoveryPath);
    expect(note).toContain("0600");
    expect(note.toLowerCase()).toContain("token");
  });
});
