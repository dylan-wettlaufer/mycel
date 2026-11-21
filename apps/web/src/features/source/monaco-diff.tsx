import { useEffect, useRef } from "react";
import type { ChangeDiff } from "@mycel/shared";
import { editorLanguage, editorOptions, monaco } from "./monaco-view";

export default function MonacoDiff({ diff }: { diff: ChangeDiff }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const language = editorLanguage(diff.path);
    const original = monaco.editor.createModel(
      diff.beforeContent ?? "",
      language,
      monaco.Uri.parse(`mycel-history://${diff.changeId}/before/${diff.path}`),
    );
    const modified = monaco.editor.createModel(
      diff.afterContent ?? "",
      language,
      monaco.Uri.parse(`mycel-history://${diff.changeId}/after/${diff.path}`),
    );
    const editor = monaco.editor.createDiffEditor(container.current, {
      ...editorOptions,
      theme: "mycel",
      originalEditable: false,
      renderSideBySide: false,
      hideUnchangedRegions: { enabled: true },
    });
    editor.setModel({ original, modified });
    return () => {
      // Monaco requires detaching models before disposal, including during navigation.
      editor.setModel(null);
      editor.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [diff]);
  return <div ref={container} className="h-[480px]" />;
}
