import { DiffEditor } from "@monaco-editor/react";
import type { ChangeDiff } from "@mycel/shared";
import { editorOptions } from "./monaco-view";
export default function MonacoDiff({ diff }: { diff: ChangeDiff }) {
  return (
    <DiffEditor
      height="480px"
      original={diff.beforeContent ?? ""}
      modified={diff.afterContent ?? ""}
      originalModelPath={`mycel-history://${diff.changeId}/before/${diff.path}`}
      modifiedModelPath={`mycel-history://${diff.changeId}/after/${diff.path}`}
      language="typescript"
      theme="mycel"
      options={{
        ...editorOptions,
        originalEditable: false,
        renderSideBySide: true,
      }}
    />
  );
}
