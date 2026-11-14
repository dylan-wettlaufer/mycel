import { useSyncExternalStore } from "react";
import type { WorkspaceView } from "@/components/layout/app-shell";
export interface Navigation {
  view: WorkspaceView;
  nodeId?: string;
  rootId?: string;
  changeId?: string;
  source?: boolean;
}
export function parseNavigation(hash: string): Navigation {
  const query = new URLSearchParams(hash.replace(/^#/, ""));
  const view = query.get("view");
  return {
    view:
      view === "Graph" || view === "Activity" || view === "Explorer"
        ? view
        : "Dashboard",
    ...(query.get("node") ? { nodeId: query.get("node")! } : {}),
    ...(query.get("root") ? { rootId: query.get("root")! } : {}),
    ...(query.get("change") && /^\d+$/.test(query.get("change")!)
      ? { changeId: query.get("change")! }
      : {}),
    ...(query.get("source") === "1" ? { source: true } : {}),
  };
}
function subscribe(listener: () => void) {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}
export function useNavigation() {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  const navigate = (next: Navigation) => {
    const query = new URLSearchParams({ view: next.view });
    if (next.nodeId) query.set("node", next.nodeId);
    if (next.rootId) query.set("root", next.rootId);
    if (next.changeId) query.set("change", next.changeId);
    if (next.source) query.set("source", "1");
    window.location.hash = query.toString();
  };
  return { navigation: parseNavigation(hash), navigate };
}
