import { useMemo, useRef } from "react";
import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { autocompletion } from "@codemirror/autocomplete";
import { syntaxHighlighting } from "@codemirror/language";
import { schemaCompletionSource, sql } from "@codemirror/lang-sql";
import type { TableSchema } from "../../../queries/databases";
import { isRunShortcut } from "../layout";
import { buildSqlSchema, keywordSnippetSource } from "./completion";
import { sqlEditorTheme, sqlHighlightStyle } from "./sqlTheme";

export interface SqlCodeEditorProps {
  value: string;
  onChange: (next: string) => void;
  onRun: () => void;
  schema: TableSchema[];
  placeholder: string;
}

export default function SqlCodeEditor({
  value,
  onChange,
  onRun,
  schema,
  placeholder,
}: SqlCodeEditorProps) {
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const sqlSchema = useMemo(() => buildSqlSchema(schema), [schema]);
  const extensions = useMemo(
    () => [
      sqlEditorTheme,
      syntaxHighlighting(sqlHighlightStyle),
      sql({ schema: sqlSchema, upperCaseKeywords: true }),
      autocompletion({
        override: [keywordSnippetSource, schemaCompletionSource({ schema: sqlSchema })],
      }),
    ],
    [sqlSchema],
  );

  return (
    <div
      className="h-full min-h-0"
      onKeyDown={(e) => {
        if (isRunShortcut(e)) {
          e.preventDefault();
          onRun();
        } else if (e.key === "Escape") {
          editorRef.current?.view?.contentDOM.blur();
        }
      }}
    >
      <CodeMirror
        ref={editorRef}
        value={value}
        onChange={onChange}
        theme="none"
        height="100%"
        placeholder={placeholder}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLineGutter: false,
          highlightActiveLine: false,
          highlightSelectionMatches: false,
          searchKeymap: false,
          autocompletion: false,
        }}
        extensions={extensions}
      />
    </div>
  );
}
