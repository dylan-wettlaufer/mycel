import { useSyncExternalStore } from "react";
import type { WorkspaceView } from "@/components/layout/app-shell";
export interface Navigation {
  view: WorkspaceView;
  nodeId?: string;
  rootId?: string;
  changeId?: string;
  relationships?: boolean;
  source?: boolean;
  files?: boolean;
  folder?: string;
  part?: string;
  component?: string;
}
export function parseNavigation(hash: string): Navigation {
  const query = new URLSearchParams(hash.replace(/^#/, ""));
  const view = query.get("view");
  if (view === "Dashboard" || view === "Features") return { view: "Graph" };
  const relationships = query.get("relationships");
  return {
    view: view === "Activity" || view === "Explorer" ? view : "Graph",
    ...(query.get("node") ? { nodeId: query.get("node")! } : {}),
    ...(query.get("root") ? { rootId: query.get("root")! } : {}),
    ...(query.get("change") && /^\d+$/.test(query.get("change")!)
      ? { changeId: query.get("change")! }
      : {}),
    ...(query.get("files") === "1" ? { files: true } : {}),
    ...(relationships === "1" || relationships === "0"
      ? { relationships: relationships === "1" }
      : {}),
    ...(query.get("folder") ? { folder: query.get("folder")! } : {}),
    ...(query.get("part") ? { part: query.get("part")! } : {}),
    ...(query.get("component") ? { component: query.get("component")! } : {}),
    ...(query.get("source") === "1" ? { source: true } : {}),
  };
}
function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}
export function navigationHref(next: Navigation): string {
  const query = new URLSearchParams({ view: next.view });
  if (next.nodeId) query.set("node", next.nodeId);
  if (next.rootId) query.set("root", next.rootId);
  if (next.changeId) query.set("change", next.changeId);
  if (next.files) query.set("files", "1");
  if (next.relationships !== undefined)
    query.set("relationships", next.relationships ? "1" : "0");
  if (next.folder) query.set("folder", next.folder);
  if (next.part) query.set("part", next.part);
  if (next.component) query.set("component", next.component);
  if (next.source) query.set("source", "1");
  return `#${query}`;
}
export function useNavigation() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const navigate = (next: Navigation) => {
    window.location.hash = navigationHref(next);
  };
  return { navigation: parseNavigation(hash), navigate };
}
