import { useEffect, useRef } from "react";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/languages/definitions/typescript/register.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import type { SourceRange } from "@mycel/shared";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });
monaco.editor.defineTheme("mycel", {
  base: "vs-dark",
  inherit: true,
  rules: [],
  colors: {
    "editor.background": "#192125",
    "editor.foreground": "#eeeeee",
    "editor.lineHighlightBackground": "#2a3938",
    "editorLineNumber.foreground": "#879693",
  },
});
export const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions =
  {
    readOnly: true,
    automaticLayout: true,
    minimap: { enabled: false },
    fontFamily: '"JetBrains Mono Variable", monospace',
    fontSize: 12,
    scrollBeyondLastLine: false,
    padding: { top: 12 },
  };

export default function MonacoView({
  content,
  path,
  range,
}: {
  content: string;
  path: string;
  range: SourceRange;
}) {
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const select = (instance: monaco.editor.IStandaloneCodeEditor) => {
    instance.setSelection({
      startLineNumber: range.startLine,
      startColumn: range.startColumn,
      endLineNumber: range.endLine,
      endColumn: range.endColumn,
    });
    instance.revealLineInCenter(range.startLine);
  };
  useEffect(() => {
    const instance = editor.current;
    if (instance) {
      instance.setSelection({
        startLineNumber: range.startLine,
        startColumn: range.startColumn,
        endLineNumber: range.endLine,
        endColumn: range.endColumn,
      });
      instance.revealLineInCenter(range.startLine);
    }
  }, [range, content]);
  const onMount: OnMount = (instance) => {
    editor.current = instance;
    select(instance);
  };
  return (
    <Editor
      height="480px"
      path={path}
      language="typescript"
      value={content}
      theme="mycel"
      options={editorOptions}
      onMount={onMount}
    />
  );
}

export { monaco };
