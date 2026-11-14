import type { ReactNode } from "react";
import {
  Activity,
  FolderTree,
  LayoutDashboard,
  Network,
  Waypoints,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ConnectionStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

interface NavItem {
  label: WorkspaceView;
  icon: LucideIcon;
}

const navItems: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard },
  { label: "Graph", icon: Network },
  { label: "Activity", icon: Activity },
  { label: "Explorer", icon: FolderTree },
];

export type WorkspaceView = "Dashboard" | "Graph" | "Activity" | "Explorer";

interface AppShellProps {
  view: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  projectName: string;
  connection: ConnectionStatus;
  liveConnection: ConnectionStatus;
  children: ReactNode;
}

export function AppShell({
  projectName,
  connection,
  liveConnection,
  children,
  view,
  onNavigate,
}: AppShellProps) {
  return (
    <div className="flex min-h-svh flex-col flex-row bg-background text-foreground">
      <aside className="w-full md:w-52 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground flex">
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <Waypoints className="size-5 text-sidebar-primary" aria-hidden />
          <span className="text-base font-semibold tracking-tight">Mycel</span>
        </div>
        <nav
          aria-label="Primary"
          className="flex md:flex-col gap-1 p-2 overflow-x-auto"
        >
          {navItems.map(({ label, icon: Icon }) => (
            <Button
              key={label}
              type="button"
              variant="ghost"
              onClick={() => onNavigate(label)}
              aria-current={label === view ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                "justify-start",
                label === view
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Button>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-4 md:px-6">
          <h1 className="truncate text-sm font-medium">{projectName}</h1>
          <div className="flex items-center gap-3">
            <span
              className="text-xs text-muted-foreground"
              aria-label="Live connection"
            >
              {liveConnection === "connected"
                ? "Live updates"
                : liveConnection === "checking"
                  ? "Connecting live…"
                  : "Live reconnecting…"}
            </span>
            <Badge variant="outline" className="gap-1.5" role="status">
              <span
                aria-hidden
                className={cn(
                  "size-1.5 rounded-full",
                  connection === "connected"
                    ? "bg-success"
                    : connection === "checking"
                      ? "bg-muted-foreground"
                      : "bg-destructive",
                )}
              />
              {connection === "connected"
                ? "Connected"
                : connection === "checking"
                  ? "Checking…"
                  : "Disconnected"}
            </Badge>
          </div>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
