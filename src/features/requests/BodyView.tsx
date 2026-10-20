import { useState } from "react";
import clsx from "clsx";
import type { BodyCapture } from "../../store/types";
import { Badge } from "../../components/ui/primitives";
import { JsonTree } from "./JsonTree";

export function BodyView({ body }: { body: BodyCapture | null | undefined }) {
  const [expanded, setExpanded] = useState(false);
  if (!body) {
    return <p className="p-3 font-mono text-[12px] text-muted">No body</p>;
  }
  const mime = body.mime?.toLowerCase() ?? "";
  if (body.is_binary && body.data_b64 && mime.startsWith("image/")) {
    return (
      <div className="flex flex-col items-start gap-2 p-3">
        <img
          src={`data:${mime.split(";")[0]};base64,${body.data_b64}`}
          alt="response preview"
          className="max-h-72 max-w-full rounded border border-line bg-surface-2 object-contain"
        />
        <p className="font-mono text-[10px] text-muted/70">
          {body.size} bytes{body.truncated ? " · preview truncated at capture cap" : ""}
        </p>
      </div>
    );
  }
  if (!body.is_binary && mime.includes("svg")) {
    return (
      <div className="flex flex-col items-start gap-2 p-3">
        <img
          src={`data:image/svg+xml;utf8,${encodeURIComponent(body.text)}`}
          alt="response preview"
          className="max-h-72 max-w-full rounded border border-line bg-surface-2 object-contain"
        />
        <p className="font-mono text-[10px] text-muted/70">
          {body.size} bytes{body.truncated ? " · preview truncated at capture cap" : ""}
        </p>
      </div>
    );
  }
  if (body.is_binary) {
    return (
      <p className="p-3 font-mono text-[12px] text-muted">
        Binary body ({body.size} bytes) — not displayed
      </p>
    );
  }
  const isJson = body.mime?.includes("json") || /^\s*[[{]/.test(body.text);
  if (isJson && !body.truncated) {
    try {
      const parsed = JSON.parse(body.text);
      return (
        <div className="flex flex-col">
          <JsonTree data={parsed} />
          <p className="border-t border-line/50 px-3 py-1 text-[10px] text-muted/70">
            click any key to copy its JSON path
          </p>
        </div>
      );
    } catch {
      // fall through to raw
    }
  }
  const long = body.text.length > 5000 && !expanded;
  return (
    <div className="flex flex-col">
      {body.truncated && (
        <div className="border-b border-line px-3 py-1.5">
          <Badge tone="warn">truncated at {body.size} bytes — JSON tree disabled</Badge>
        </div>
      )}
      <pre
        onClick={() => long && setExpanded(true)}
        className={clsx(
          "whitespace-pre-wrap p-3 font-mono text-[length:var(--mono-size,12px)] leading-relaxed text-txt/90 [overflow-wrap:anywhere]",
          long && "cursor-pointer",
        )}
      >
        {long ? body.text.slice(0, 5000) + "\n… click to expand" : body.text}
      </pre>
    </div>
  );
}
