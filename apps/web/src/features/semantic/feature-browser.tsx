import { lazy, Suspense } from "react";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useResource } from "@/hooks/use-resource";
import { isFeatureBehaviour, isFeatureList } from "./feature-contracts";

const BehaviourGraph = lazy(() => import("./behaviour-graph"));

function featureName(name: string) {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function FeatureBrowser({
  featureId,
  revision,
  onSelect,
  onBack,
}: {
  featureId: string | undefined;
  revision: number;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  const list = useResource(
    featureId ? null : "/api/graph/semantic/features",
    isFeatureList,
    revision,
  );
  const detail = useResource(
    featureId
      ? `/api/graph/semantic/features/${encodeURIComponent(featureId)}/behaviour`
      : null,
    isFeatureBehaviour,
    revision,
  );
  const data = detail.data;
  const feature = data?.entities.find((entity) => entity.id === data.featureId);

  if (featureId) {
    return (
      <section className="mx-auto w-full max-w-[96rem] space-y-4">
        <Button variant="outline" size="sm" onClick={onBack}>
          All features
        </Button>
        {detail.error ? (
          <p role="alert">Feature unavailable. {detail.error}</p>
        ) : !data || !feature ? (
          <p>Loading feature…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="break-all text-xl font-semibold">
                {featureName(feature.name)}
              </h2>
              {feature.attributes.status === "candidate" && (
                <Badge variant="outline">Inferred</Badge>
              )}
            </div>
            {data.truncated && (
              <p className="text-sm text-muted-foreground">
                Query limits may omit some paths.
              </p>
            )}
            <Suspense fallback={<p>Loading behaviour graph…</p>}>
              <BehaviourGraph
                key={feature.id}
                traces={data.traces}
                members={data.entities}
                revision={data.revision}
              />
            </Suspense>
          </>
        )}
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl space-y-4">
      <h2 className="text-xl font-semibold">Features</h2>
      {list.error ? (
        <p role="alert">Features unavailable. {list.error}</p>
      ) : !list.data ? (
        <p>Loading features…</p>
      ) : list.data.features.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No features discovered in this repository.
        </p>
      ) : (
        <>
          <ul className="divide-y rounded-lg border">
            {list.data.features.map((item) => (
              <li key={item.id}>
                <Button
                  variant="ghost"
                  className="h-auto w-full justify-start whitespace-normal p-3 text-left"
                  onClick={() => onSelect(item.id)}
                >
                  <span className="min-w-0 flex-1 break-all">
                    {featureName(item.name)}
                    {item.attributes.scope && (
                      <span className="block font-mono text-xs font-normal text-muted-foreground">
                        {item.attributes.scope}
                      </span>
                    )}
                  </span>
                  {item.attributes.status === "candidate" && (
                    <Badge variant="outline">Inferred</Badge>
                  )}
                  <ChevronRight aria-hidden className="text-muted-foreground" />
                </Button>
              </li>
            ))}
          </ul>
          {list.data.truncated && (
            <p className="text-sm text-muted-foreground">
              More features are present in the index.
            </p>
          )}
        </>
      )}
    </section>
  );
}
