import { useEffect, useRef } from "react";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/editor/contrib/hover/browser/hoverContribution.js";
import "monaco-editor/languages/definitions/python/register.js";
import "monaco-editor/languages/definitions/typescript/register.js";
import EditorWorker from "monaco-editor/editor/editor.worker.js?worker";
import { sourceLanguageForPath } from "@mycel/shared";
import type { EdgeSourceRange, SourceRange } from "@mycel/shared";

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

export function editorLanguage(path: string): string {
  return sourceLanguageForPath(path) === "python" ? "python" : "typescript";
}

export interface SourceWorkspaceOptions {
  wrapped: boolean;
  declarationLine: number | undefined;
  locationKey: string;
  sourceConnections?: SourceConnections | undefined;
}

export interface SourceConnections {
  revision: number;
  sites: (EdgeSourceRange & { edgeId: string; label: string })[];
  activeEdgeId: string | undefined;
}

function markConnections(
  instance: monaco.editor.IStandaloneCodeEditor,
  decorations: monaco.editor.IEditorDecorationsCollection,
  sites: SourceConnections["sites"] | undefined,
  activeEdgeId: string | undefined,
) {
  const model = instance.getModel();
  if (!model) return;
  const lineCount = model.getLineCount();
  decorations.set(
    (sites ?? [])
      .filter(({ endLine }) => endLine <= lineCount)
      .map((site) => ({
        range: new monaco.Range(
          site.startLine,
          1,
          site.endLine,
          model.getLineMaxColumn(site.endLine),
        ),
        options: {
          isWholeLine: true,
          className:
            site.edgeId === activeEdgeId
              ? "source-connection-highlight source-connection-active"
              : "source-connection-highlight",
          linesDecorationsClassName: "source-connection-gutter",
          hoverMessage: { value: site.label.replace(/[\\`*_[\]<>]/g, "\\$&") },
        },
      })),
  );
}

function revealLocation(
  instance: monaco.editor.IStandaloneCodeEditor,
  decorations: monaco.editor.IEditorDecorationsCollection,
  range: SourceRange | undefined,
  declarationLine: number | undefined,
  connectionLine: number | undefined,
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
  } else {
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
  }
  const line = connectionLine ?? declarationLine;
  if (line !== undefined) instance.revealLineInCenterIfOutsideViewport(line);
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
    connectionDecorations: monaco.editor.IEditorDecorationsCollection;
  } | null>(null);
  const declarationLine = workspace?.declarationLine;
  const locationKey = workspace?.locationKey;
  const sites = workspace?.sourceConnections?.sites;
  const activeEdgeId = workspace?.sourceConnections?.activeEdgeId;
  const connectionLine = sites?.find(
    (site) => site.edgeId === activeEdgeId,
  )?.startLine;
  useEffect(() => {
    const current = editor.current;
    if (current)
      revealLocation(
        current.instance,
        current.decorations,
        range,
        declarationLine,
        connectionLine,
      );
  }, [range, declarationLine, connectionLine, locationKey, path, content]);
  useEffect(() => {
    const current = editor.current;
    if (current)
      markConnections(
        current.instance,
        current.connectionDecorations,
        sites,
        activeEdgeId,
      );
  }, [sites, activeEdgeId, path, content]);
  const onMount: OnMount = (instance) => {
    const decorations = instance.createDecorationsCollection();
    const connectionDecorations = instance.createDecorationsCollection();
    editor.current = { instance, decorations, connectionDecorations };
    revealLocation(
      instance,
      decorations,
      range,
      declarationLine,
      connectionLine,
    );
    markConnections(instance, connectionDecorations, sites, activeEdgeId);
  };
  return (
    <Editor
      height={workspace ? "100%" : "480px"}
      path={path}
      language={editorLanguage(path)}
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
