import { describe, expect, it } from "vitest";
import { decodeChunks } from "./shellcodec";

describe("decodeChunks", () => {
  it("decodes multiple chunks in order into one buffer", () => {
    const data = decodeChunks([btoa("hel"), btoa("lo "), btoa("world")]);
    expect(new TextDecoder().decode(data)).toBe("hello world");
  });

  it("returns an empty buffer for an empty chunk array", () => {
    expect(decodeChunks([])).toEqual(new Uint8Array(0));
  });

  it("decodes binary control bytes", () => {
    const data = decodeChunks([btoa("\x1b[2J\r\n")]);
    expect(Array.from(data)).toEqual([0x1b, 0x5b, 0x32, 0x4a, 0x0d, 0x0a]);
  });

  it("handles a mix of empty and non-empty chunks", () => {
    const data = decodeChunks([btoa(""), btoa("ab"), btoa("")]);
    expect(new TextDecoder().decode(data)).toBe("ab");
  });
});
