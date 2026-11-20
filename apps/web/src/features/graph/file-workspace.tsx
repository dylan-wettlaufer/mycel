import { Maximize2, Minimize2, WrapText } from "lucide-react";
import { Tabs } from "radix-ui";
import { useState, type ReactNode } from "react";
import type { GraphNode } from "@mycel/shared";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileSymbols } from "@/features/details/file-symbols";
import { NodeDetailsPanel } from "@/features/details/node-details";
import { SourcePanel } from "@/features/source/source-panel";
import { cn } from "@/lib/utils";

export function FileWorkspace({
  node,
  file,
  graph,
  connections,
  revision,
  sourceReveal,
  detailsOpen,
  onDetailsChange,
  onSelect,
  onScope,
  onActivity,
}: {
  node: GraphNode | undefined;
  file: GraphNode | undefined;
  graph: ReactNode;
  connections: ReactNode;
  revision: number;
  sourceReveal: number;
  detailsOpen: boolean;
  onDetailsChange: (open: boolean) => void;
  onSelect: (node: GraphNode) => void;
  onScope: (node: GraphNode) => void;
  onActivity: (node: GraphNode) => void;
}) {
  const [wrapped, setWrapped] = useState(true);
  const [focused, setFocused] = useState(false);
  const declarationLine =
    node?.kind !== "file" ? node?.range.startLine : undefined;

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,2fr)] gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-rows-1">
      <div
        className={cn(
          "col-start-1 row-start-1 flex min-h-0 min-w-0 flex-col",
          focused && "invisible",
        )}
        inert={focused}
      >
        {graph}
      </div>
      <Tabs.Root
        asChild
        value={detailsOpen ? "details" : "source"}
        onValueChange={(value) => {
          if (value === "details") setFocused(false);
          onDetailsChange(value === "details");
        }}
      >
        <aside
          aria-label="File viewer"
          className={cn(
            "flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card",
            focused
              ? "col-span-full row-span-full z-10"
              : "col-start-1 row-start-2 lg:col-start-2 lg:row-start-1",
          )}
        >
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-3 py-2">
            <div className="min-w-0 flex-1 basis-36">
              <h3 className="truncate text-sm font-semibold" title={node?.path}>
                {node
                  ? (file?.name ?? node.path.split("/").at(-1))
                  : "Loading file…"}
              </h3>
              {node && (
                <p
                  className="truncate font-mono text-xs text-muted-foreground"
                  title={node.path}
                >
                  {node.path}
                  {declarationLine === undefined ? "" : `:${declarationLine}`}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Tabs.List
                aria-label="File view"
                className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5"
              >
                <Tabs.Trigger asChild value="source">
                  <Button
                    variant="ghost"
                    size="xs"
                    className="data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs"
                  >
                    Source
                  </Button>
                </Tabs.Trigger>
                <Tabs.Trigger asChild value="details">
                  <Button
                    variant="ghost"
                    size="xs"
                    className="data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs"
                  >
                    Details
                  </Button>
                </Tabs.Trigger>
              </Tabs.List>
              {!detailsOpen && (
                <>
                  <Button
                    variant={wrapped ? "secondary" : "ghost"}
                    size="icon-xs"
                    aria-label="Wrap lines"
                    title="Wrap lines"
                    aria-pressed={wrapped}
                    onClick={() => setWrapped((value) => !value)}
                  >
                    <WrapText aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    aria-pressed={focused}
                    onClick={() => setFocused((value) => !value)}
                  >
                    {focused ? (
                      <Minimize2 aria-hidden />
                    ) : (
                      <Maximize2 aria-hidden />
                    )}
                    {focused ? "Show graph" : "Focus source"}
                  </Button>
                </>
              )}
            </div>
          </div>
          <Tabs.Content
            value="source"
            forceMount
            className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
          >
            {node ? (
              <SourcePanel
                node={node}
                revision={revision}
                workspace={{
                  wrapped,
                  declarationLine,
                  locationKey: `${node.id}:${sourceReveal}`,
                }}
              />
            ) : (
              <p className="p-3 text-sm">Loading source…</p>
            )}
          </Tabs.Content>
          <Tabs.Content value="details" className="min-h-0 flex-1">
            <ScrollArea className="h-full min-h-0">
              {node && (
                <div className="space-y-3 p-3">
                  <NodeDetailsPanel
                    node={node}
                    onSelect={onSelect}
                    onScope={onScope}
                    revision={revision}
                  />
                  {file && (
                    <FileSymbols
                      file={file}
                      revision={revision}
                      onSelect={onSelect}
                    />
                  )}
                  {connections}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onActivity(node)}
                  >
                    Show node activity
                  </Button>
                </div>
              )}
            </ScrollArea>
          </Tabs.Content>
        </aside>
      </Tabs.Root>
    </div>
  );
}
