import { useState } from "react";
import clsx from "clsx";
import type { BodyCapture } from "../../store/types";
import { Badge } from "../../components/ui/primitives";

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
  let text = body.text;
  const isJson = body.mime?.includes("json") || /^\s*[[{]/.test(text);
  if (isJson) {
    try {
      text = JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      // leave raw
    }
  }
  const long = text.length > 5000 && !expanded;
  return (
    <div className="flex flex-col">
      {body.truncated && (
        <div className="border-b border-line px-3 py-1.5">
          <Badge tone="warn">truncated at {body.size} bytes</Badge>
        </div>
      )}
      <pre
        onClick={() => long && setExpanded(true)}
        className={clsx(
          "overflow-auto p-3 font-mono text-[12px] leading-relaxed text-txt/90",
          long && "cursor-pointer",
        )}
      >
        {long ? text.slice(0, 5000) + "\n… click to expand" : text}
      </pre>
    </div>
  );
}
