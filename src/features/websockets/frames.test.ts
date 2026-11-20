import { describe, expect, it } from "vitest";
import type { WsFrame } from "../../store/traffic";
import {
  connectionParts,
  filterFrames,
  formatDuration,
  formatPayload,
  frameCounts,
  highlightJson,
} from "./frames";

function frame(seq: number, direction: WsFrame["direction"], text: string, isBinary = false): WsFrame {
  return {
    seq,
    direction,
    at: 1_000 + seq,
    payload: { text, is_binary: isBinary, size: isBinary ? 16 : text.length, truncated: false, mime: null },
  };
}

const frames: WsFrame[] = [
  frame(1, "Sent", '{"type":"ping"}'),
  frame(2, "Received", '{"type":"pong"}'),
  frame(3, "Received", '{"type":"order.updated"}'),
  frame(4, "Sent", "", true),
];

describe("filterFrames", () => {
  it("returns every frame for an empty query and the all direction", () => {
    expect(filterFrames(frames, "", "all")).toEqual(frames);
  });

  it("keeps frames whose payload text contains the query, ignoring case", () => {
    expect(filterFrames(frames, "PONG", "all").map((f) => f.seq)).toEqual([2]);
  });

  it("narrows by direction", () => {
    expect(filterFrames(frames, "", "sent").map((f) => f.seq)).toEqual([1, 4]);
    expect(filterFrames(frames, "", "received").map((f) => f.seq)).toEqual([2, 3]);
  });

  it("combines query and direction", () => {
    expect(filterFrames(frames, "type", "received").map((f) => f.seq)).toEqual([2, 3]);
  });
});

describe("frameCounts", () => {
  it("counts all, sent and received frames", () => {
    expect(frameCounts(frames, "")).toEqual({ all: 4, sent: 2, received: 2 });
  });

  it("counts only frames matching the query", () => {
    expect(frameCounts(frames, "p")).toEqual({ all: 3, sent: 1, received: 2 });
  });
});

describe("formatPayload", () => {
  it("pretty-prints payloads that parse as JSON", () => {
    expect(formatPayload(frames[0].payload)).toEqual({
      kind: "json",
      text: '{\n  "type": "ping"\n}',
    });
  });

  it("returns raw text when the payload is not JSON", () => {
    expect(formatPayload({ text: "hello", is_binary: false, size: 5, truncated: false, mime: null })).toEqual({
      kind: "text",
      text: "hello",
    });
  });

  it("treats bare JSON scalars as raw text", () => {
    expect(formatPayload({ text: "42", is_binary: false, size: 2, truncated: false, mime: null }).kind).toBe("text");
  });

  it("describes binary payloads by size", () => {
    expect(formatPayload(frames[3].payload)).toEqual({ kind: "binary", text: "(16 bytes binary)" });
  });
});

describe("highlightJson", () => {
  it("splits pretty JSON into typed tokens that reassemble the input", () => {
    const text = '{\n  "a": "x",\n  "b": 1.5,\n  "c": null,\n  "d": true\n}';
    const tokens = highlightJson(text);
    expect(tokens.map((t) => t.text).join("")).toBe(text);
    expect(tokens.filter((t) => t.kind === "key").map((t) => t.text)).toEqual(['"a"', '"b"', '"c"', '"d"']);
    expect(tokens.filter((t) => t.kind === "string").map((t) => t.text)).toEqual(['"x"']);
    expect(tokens.filter((t) => t.kind === "number").map((t) => t.text)).toEqual(["1.5"]);
    expect(tokens.filter((t) => t.kind === "literal").map((t) => t.text)).toEqual(["null", "true"]);
  });

  it("handles escaped quotes inside strings", () => {
    const text = '{\n  "k": "say \\"hi\\""\n}';
    const tokens = highlightJson(text);
    expect(tokens.map((t) => t.text).join("")).toBe(text);
    expect(tokens.find((t) => t.kind === "string")?.text).toBe('"say \\"hi\\""');
  });
});

describe("connectionParts", () => {
  it("splits a WebSocket URL into host and path", () => {
    expect(connectionParts("wss://rt.shop.dev/socket?x=1")).toEqual({ host: "rt.shop.dev", path: "/socket?x=1" });
  });

  it("keeps a non-default port in the host", () => {
    expect(connectionParts("ws://10.0.2.2:8081/hot")).toEqual({ host: "10.0.2.2:8081", path: "/hot" });
  });

  it("falls back to the raw value when it is not a URL", () => {
    expect(connectionParts("(unknown)")).toEqual({ host: "(unknown)", path: "" });
  });
});

describe("formatDuration", () => {
  it("formats minutes and seconds", () => {
    expect(formatDuration(131_000)).toBe("02:11");
  });

  it("includes hours past one hour", () => {
    expect(formatDuration(3_723_000)).toBe("1:02:03");
  });

  it("clamps negative durations to zero", () => {
    expect(formatDuration(-5)).toBe("00:00");
  });
});
