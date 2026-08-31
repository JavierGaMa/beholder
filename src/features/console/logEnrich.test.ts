import { describe, expect, it } from "vitest";
import { enrich } from "./logEnrich";
import type { LogLine } from "../../store/console-types";

function msg(tag: string, message: string): Pick<LogLine, "tag" | "message"> {
  return { tag, message };
}

describe("enrich", () => {
  it("pretty prints JSON objects from ReactNativeJS", () => {
    const out = enrich(msg("ReactNativeJS", '{"user":1}'));
    expect(out).toHaveProperty("pretty");
    if ("pretty" in out) {
      expect(out.pretty).toBe(JSON.stringify({ user: 1 }, null, 2));
      expect(out.highlighted.map((t) => t.text).join("")).toBe(out.pretty);
    }
  });

  it("pretty prints JSON arrays", () => {
    const out = enrich(msg("ReactNative", '[1,2,{"a":true}]'));
    expect(out).toHaveProperty("pretty");
    if ("pretty" in out) {
      expect(out.pretty).toBe(JSON.stringify([1, 2, { a: true }], null, 2));
    }
  });

  it("falls back to plain text on truncated JSON", () => {
    expect(enrich(msg("ReactNativeJS", '{"user":1'))).toEqual({ text: '{"user":1' });
    expect(enrich(msg("ReactNativeJS", '{"a": "unclosed'))).toHaveProperty("text");
  });

  it("does not prettify non-JSON messages", () => {
    expect(enrich(msg("ReactNativeJS", "Running app on Android"))).toEqual({
      text: "Running app on Android",
    });
    expect(enrich(msg("ReactNativeJS", "12 monkeys"))).toEqual({ text: "12 monkeys" });
  });

  it("gates on RN tags", () => {
    expect(enrich(msg("SystemUI", '{"a":1}'))).toEqual({ text: '{"a":1}' });
    expect(enrich(msg("chatty", '{"a":1}'))).toEqual({ text: '{"a":1}' });
  });

  it("matches unknown-prefixed ReactNativeJS", () => {
    const out = enrich(msg("unknown:ReactNativeJS", '{"ok":true}'));
    expect(out).toHaveProperty("pretty");
  });

  it("matches unknown-prefixed ReactNative", () => {
    const out = enrich(msg("unknown:ReactNative", "[1]"));
    expect(out).toHaveProperty("pretty");
  });

  it("tokenizes keys, strings, numbers and literals with distinct types", () => {
    const out = enrich(msg("ReactNativeJS", '{"k":"s","n":1.5,"b":null,"t":true}'));
    if (!("highlighted" in out)) throw new Error("expected highlighted");
    const types = new Set(out.highlighted.map((t) => t.type));
    expect(types).toContain("key");
    expect(types).toContain("string");
    expect(types).toContain("number");
    expect(types).toContain("literal");
    expect(out.highlighted.map((t) => t.text).join("")).toBe(out.pretty);
  });
});
