import { Fragment } from "react";
import type { GraphNode, NodeDetails } from "@mycel/shared";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { navigationHref, type Navigation } from "@/hooks/use-navigation";

export function GraphBreadcrumbs({
  navigation,
  componentName,
  partName,
  root,
  selected,
  unavailable,
}: {
  navigation: Navigation;
  componentName: string | undefined;
  partName: string | undefined;
  root: GraphNode | undefined;
  selected: NodeDetails | undefined;
  unavailable: boolean;
}) {
  const { component, part, files, folder, nodeId } = navigation;
  if (!component && !files && !nodeId) return null;

  const overviewPart = component ?? part;
  const componentRoute: Navigation = {
    view: "Graph",
    ...(component ? { component } : {}),
    ...(part ? { part } : {}),
  };
  const trail: { label: string; to?: Navigation; title?: string }[] = [
    {
      label: "Architecture map",
      to: {
        view: "Graph",
        ...(overviewPart ? { part: overviewPart } : {}),
      },
    },
  ];
  if (component) {
    trail.push({ label: componentName ?? "Component map", to: componentRoute });
  }
  if (files || (nodeId && !component && !part)) {
    trail.push({
      label: partName ?? folder ?? "File dependencies",
      title: "File dependencies",
      to: {
        ...componentRoute,
        files: true,
        ...(folder ? { folder } : {}),
      },
    });
  }
  if (nodeId) {
    const node = selected?.node;
    const file =
      node && node.kind !== "file"
        ? selected?.relatedFiles.nodes.find((file) => file.path === node.path)
        : undefined;
    if (file) {
      trail.push({
        label: file.name,
        title: file.path,
        to: {
          ...navigation,
          nodeId: file.id,
          rootId: root?.kind === "file" ? root.id : file.id,
        },
      });
    }
    trail.push({
      label: node
        ? node.kind === "file"
          ? node.name
          : node.qualifiedName
        : unavailable
          ? "Unavailable node"
          : "Loading node…",
      ...(node ? { title: node.path } : {}),
    });
  }

  return (
    <Breadcrumb aria-label="Graph breadcrumb" className="mb-2 min-w-0 shrink-0">
      <BreadcrumbList className="gap-x-1.5 gap-y-1 text-xs">
        {trail.map(({ label, to, title }, index) => (
          <Fragment key={index}>
            {index > 0 && <BreadcrumbSeparator />}
            <BreadcrumbItem className="min-w-0 [overflow-wrap:anywhere]">
              {to && index < trail.length - 1 ? (
                <BreadcrumbLink
                  className="rounded-sm text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  href={navigationHref(to)}
                  title={title}
                >
                  {label}
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage title={title}>{label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
