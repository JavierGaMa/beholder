import { useState } from "react";
import clsx from "clsx";
import { Check, Copy } from "lucide-react";

export function ErrorBox({
  message,
  className,
  compact,
}: {
  message: string;
  className?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(message);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div
      className={clsx(
        "flex items-start gap-2 rounded-md border border-danger/40 bg-danger/10 p-2",
        className,
      )}
    >
      <p
        className={clsx(
          "min-w-0 flex-1 break-words text-danger",
          compact ? "truncate text-[11px]" : "whitespace-pre-wrap text-[12px]",
        )}
        title={message}
      >
        {message}
      </p>
      <button
        type="button"
        onClick={copy}
        title="Copy error"
        className={clsx(
          "shrink-0 rounded p-1 text-danger/70 transition-colors hover:bg-danger/10 hover:text-danger",
          copied && "text-ok",
        )}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}
