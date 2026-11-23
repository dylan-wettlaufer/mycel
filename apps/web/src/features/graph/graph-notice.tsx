import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

export function GraphNotice({
  title,
  detail,
  error = false,
  children,
}: {
  title: string;
  detail: string;
  error?: boolean;
  children?: ReactNode;
}) {
  return (
    <Card className="shrink-0 items-start gap-2 rounded-lg px-4 py-3">
      <div role={error ? "alert" : "status"}>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs break-words text-muted-foreground">{detail}</p>
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </Card>
  );
}
