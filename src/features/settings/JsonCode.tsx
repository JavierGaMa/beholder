import { useMemo } from "react";
import clsx from "clsx";
import { tokenizeJson, type JsonTokenKind } from "./jsonTokens";

const KIND_CLASSES: Record<JsonTokenKind, string> = {
  key: "text-accent",
  string: "text-ok",
  number: "text-warn",
  boolean: "italic text-muted",
  null: "italic text-muted",
  punctuation: "text-muted",
};

export function JsonCode({ code, className }: { code: string; className?: string }) {
  const tokens = useMemo(() => tokenizeJson(code), [code]);
  return (
    <pre
      className={clsx(
        "overflow-x-auto rounded-md border border-line bg-bg p-3 font-mono text-[11px] leading-relaxed text-txt",
        className,
      )}
    >
      {tokens.map((token, i) => (
        <span key={i} className={KIND_CLASSES[token.kind]}>
          {token.text}
        </span>
      ))}
    </pre>
  );
}
