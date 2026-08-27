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
          "overflow-auto p-3 font-mono text-[12px] leading-relaxed text-txt/90",
          long && "cursor-pointer",
        )}
      >
        {long ? body.text.slice(0, 5000) + "\n… click to expand" : body.text}
      </pre>
    </div>
  );
}
