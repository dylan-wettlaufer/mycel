import type { ReactNode } from "react";
import { Activity, FolderTree, LayoutDashboard, Network, Waypoints } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  icon: LucideIcon;
  /** Only the dashboard exists so far; the rest are planned (PRD phase 5). */
  enabled: boolean;
}

const navItems: NavItem[] = [
  { label: "Dashboard", icon: LayoutDashboard, enabled: true },
  { label: "Graph", icon: Network, enabled: false },
  { label: "Activity", icon: Activity, enabled: false },
  { label: "Explorer", icon: FolderTree, enabled: false },
];

interface AppShellProps {
  projectName: string;
  connection: "connected" | "disconnected";
  children: ReactNode;
}

export function AppShell({ projectName, connection, children }: AppShellProps) {
  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-4">
          <Waypoints className="size-5 text-sidebar-primary" aria-hidden />
          <span className="text-base font-semibold tracking-tight">Mycel</span>
        </div>
        <nav aria-label="Primary" className="flex flex-col gap-1 p-2">
          {navItems.map(({ label, icon: Icon, enabled }) => (
            <button
              key={label}
              type="button"
              disabled={!enabled}
              aria-current={label === "Dashboard" ? "page" : undefined}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-50",
                label === "Dashboard"
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "text-muted-foreground enabled:hover:bg-sidebar-accent/60",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b px-4 md:px-6">
          <h1 className="truncate text-sm font-medium">{projectName}</h1>
          <Badge variant="outline" className="gap-1.5">
            <span
              aria-hidden
              className={cn(
                "size-1.5 rounded-full",
                connection === "connected" ? "bg-success" : "bg-destructive",
              )}
            />
            {connection === "connected" ? "Connected" : "Disconnected"}
          </Badge>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
