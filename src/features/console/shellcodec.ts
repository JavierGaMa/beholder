export function decodeChunks(chunks: string[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (const chunk of chunks) {
    const bin = atob(chunk);
    const part = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) part[i] = bin.charCodeAt(i);
    parts.push(part);
    total += part.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
