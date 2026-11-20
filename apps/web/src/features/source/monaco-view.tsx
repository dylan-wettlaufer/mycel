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

export interface SourceWorkspaceOptions {
  wrapped: boolean;
  declarationLine: number | undefined;
  locationKey: string;
}

function revealLocation(
  instance: monaco.editor.IStandaloneCodeEditor,
  decorations: monaco.editor.IEditorDecorationsCollection,
  range: SourceRange | undefined,
  declarationLine: number | undefined,
) {
  if (range) {
    instance.setSelection({
      startLineNumber: range.startLine,
      startColumn: range.startColumn,
      endLineNumber: range.endLine,
      endColumn: range.endColumn,
    });
    instance.revealLineInCenter(range.startLine);
    return;
  }
  if (declarationLine === undefined) {
    decorations.clear();
    return;
  }
  const line = Math.max(
    1,
    Math.min(declarationLine, instance.getModel()?.getLineCount() ?? 1),
  );
  decorations.set([
    {
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: "source-declaration-highlight",
      },
    },
  ]);
  instance.revealLineInCenterIfOutsideViewport(line);
}

export default function MonacoView({
  content,
  path,
  range,
  workspace,
}: {
  content: string;
  path: string;
  range?: SourceRange | undefined;
  workspace?: SourceWorkspaceOptions | undefined;
}) {
  const editor = useRef<{
    instance: monaco.editor.IStandaloneCodeEditor;
    decorations: monaco.editor.IEditorDecorationsCollection;
  } | null>(null);
  const declarationLine = workspace?.declarationLine;
  const locationKey = workspace?.locationKey;
  useEffect(() => {
    const current = editor.current;
    if (current)
      revealLocation(
        current.instance,
        current.decorations,
        range,
        declarationLine,
      );
  }, [range, declarationLine, locationKey, path, content]);
  const onMount: OnMount = (instance) => {
    const decorations = instance.createDecorationsCollection();
    editor.current = { instance, decorations };
    revealLocation(instance, decorations, range, declarationLine);
  };
  return (
    <Editor
      height={workspace ? "100%" : "480px"}
      path={path}
      language="typescript"
      value={content}
      theme="mycel"
      options={
        workspace
          ? {
              ...editorOptions,
              ariaLabel: `Source for ${path}`,
              wordWrap: workspace.wrapped ? "on" : "off",
              renderLineHighlight: "none",
            }
          : editorOptions
      }
      onMount={onMount}
    />
  );
}

export { monaco };
