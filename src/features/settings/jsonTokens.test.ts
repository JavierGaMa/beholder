import { describe, expect, it } from "vitest";
import { tokenizeJson } from "./jsonTokens";
import { buildMcpSnippets } from "./agentSnippets";

const SNIPPET_INPUT = {
  command: "/opt/beholder/bin/beholder-mcp",
  discoveryPath: "/Users/dev/.beholder/agent.json",
};

function text(tokens: ReturnType<typeof tokenizeJson>): string {
  return tokens.map((t) => t.text).join("");
}

describe("tokenizeJson", () => {
  it("splits an object into punctuation, key and string tokens", () => {
    const source = '{"command": "/opt/bin"}';
    const tokens = tokenizeJson(source);
    expect(tokens.map((t) => t.kind)).toEqual([
      "punctuation",
      "key",
      "punctuation",
      "string",
      "punctuation",
    ]);
    expect(text(tokens)).toBe(source);
  });

  it("roundtrips every generated client snippet without loss", () => {
    for (const snippet of buildMcpSnippets(SNIPPET_INPUT)) {
      const tokens = tokenizeJson(snippet.code);
      expect(text(tokens)).toBe(snippet.code);
      for (const token of tokens) {
        expect(token.text.length).toBeGreaterThan(0);
      }
    }
  });

  it("classifies object keys as keys and value strings as strings", () => {
    const tokens = tokenizeJson('{"mcpServers": {"beholder": {"command": "/opt/bin"}}}');
    expect(tokens.find((t) => t.text === '"command"')?.kind).toBe("key");
    expect(tokens.find((t) => t.text === '"/opt/bin"')?.kind).toBe("string");
    expect(tokens.find((t) => t.text === '"mcpServers"')?.kind).toBe("key");
  });

  it("classifies integers, negatives, fractions and exponents as numbers", () => {
    const source = '{"port": 8081, "n": -1.5e3, "z": 0}';
    const tokens = tokenizeJson(source);
    expect(tokens.find((t) => t.text === "8081")?.kind).toBe("number");
    expect(tokens.find((t) => t.text === "-1.5e3")?.kind).toBe("number");
    expect(tokens.find((t) => t.text === "0")?.kind).toBe("number");
    expect(text(tokens)).toBe(source);
  });

  it("classifies true and false as booleans and null as null", () => {
    const source = '{"on": true, "off": false, "x": null}';
    const tokens = tokenizeJson(source);
    expect(tokens.find((t) => t.text === "true")?.kind).toBe("boolean");
    expect(tokens.find((t) => t.text === "false")?.kind).toBe("boolean");
    expect(tokens.find((t) => t.text === "null")?.kind).toBe("null");
    expect(text(tokens)).toBe(source);
  });

  it("groups braces, brackets, commas, colons and whitespace as punctuation", () => {
    const tokens = tokenizeJson("[1, 2]");
    expect(tokens.map((t) => t.kind)).toEqual([
      "punctuation",
      "number",
      "punctuation",
      "number",
      "punctuation",
    ]);
  });

  it("keeps escaped quotes inside a single string token", () => {
    const source = '{"path": "a\\"b"}';
    const tokens = tokenizeJson(source);
    const quoted = tokens.filter((t) => t.text.startsWith('"'));
    expect(quoted).toHaveLength(2);
    expect(quoted[1]?.text).toBe('"a\\"b"');
    expect(text(tokens)).toBe(source);
  });

  it("detects keys across whitespace before the colon", () => {
    const tokens = tokenizeJson('{"a" : 1}');
    expect(tokens.find((t) => t.text === '"a"')?.kind).toBe("key");
  });

  it("never throws and stays lossless on truncated input", () => {
    const source = '{"a": "unterminated';
    const tokens = tokenizeJson(source);
    expect(text(tokens)).toBe(source);
  });
});
