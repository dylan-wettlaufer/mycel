import { useEffect, useState } from "react";
import type { GraphNode } from "@mycel/shared";
import { FileCode, Braces, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useResource } from "@/hooks/use-resource";
import { isSearchResult } from "@/lib/contracts";

export function Explorer({
  onSelect,
  revision = 0,
}: {
  onSelect: (node: GraphNode) => void;
  revision?: number;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 200);
    return () => clearTimeout(timer);
  }, [query]);
  // Every indexed path has a source extension.
  const { data, error } = useResource(
    `/api/graph/search?q=${encodeURIComponent(search || ".")}&limit=100`,
    isSearchResult,
    revision,
  );
  const nodes = data?.nodes.filter(
    (node) =>
      filter === "all" ||
      (filter === "files" ? node.kind === "file" : node.kind !== "file"),
  );
  return (
    <section className="space-y-4" aria-label="File and symbol explorer">
      <h2 className="text-xl font-semibold">Explorer</h2>
      <div className="relative">
        <Search
          className="absolute left-3 top-2.5 size-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          aria-label="Search files and symbols"
          placeholder="Search files and symbols…"
          maxLength={1000}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-9"
        />
      </div>
      <div className="flex gap-2">
        {["all", "files", "symbols"].map((value) => (
          <Button
            key={value}
            size="sm"
            variant={filter === value ? "secondary" : "ghost"}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {value}
          </Button>
        ))}
      </div>
      {error ? (
        <p role="alert">Explorer unavailable. {error}</p>
      ) : !data ? (
        <p>Loading explorer…</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {nodes?.length} results · revision {data.revision}
          </p>
          {!nodes?.length && <p>No matching files or symbols.</p>}
          <ul className="divide-y">
            {nodes?.map((node) => (
              <li key={node.id}>
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start gap-3 py-3 text-left"
                  onClick={() => onSelect(node)}
                >
                  {node.kind === "file" ? (
                    <FileCode aria-hidden />
                  ) : (
                    <Braces aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{node.name}</span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">
                      {node.path}:{node.range.startLine}
                    </span>
                  </span>
                  <Badge variant="outline">{node.kind}</Badge>
                </Button>
              </li>
            ))}
          </ul>
          {data.truncated && (
            <p className="text-sm text-warning">
              Showing up to 100 results. Narrow your search to find more.
            </p>
          )}
        </>
      )}
    </section>
  );
}
