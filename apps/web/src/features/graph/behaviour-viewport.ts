import { useEffect, useRef, type RefObject } from "react";
import {
  getViewportForBounds,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type Rect,
  type Viewport,
} from "@xyflow/react";

const readableMinimum = 0.74;
// Layered cards stay legible a little smaller than the initial fit allows.
const refitMinimum = 0.55;
const minZoom = 0.03;
export const behaviourFitOptions = { padding: 0.12, minZoom, maxZoom: 1.05 };

type Reveal = { id: string };

export type BehaviourView = {
  rootId: string;
  wide: boolean;
  fitRequest: number;
  hasExpandedSteps: boolean;
  reveal: Reveal | null;
};

const paddingX = 16;
const paddingY = 44;
const minimumPaddingY = 12;

function panAxis(
  offset: number,
  start: number,
  length: number,
  viewportSize: number,
  padding: number,
) {
  const min = padding - start;
  const max = viewportSize - padding - start - length;
  return Math.max(min, Math.min(max, offset));
}

function revealBounds(
  viewport: Viewport,
  bounds: Rect,
  width: number,
  height: number,
) {
  const { zoom } = viewport;
  const verticalPadding = Math.max(
    minimumPaddingY,
    Math.min(paddingY, (height - bounds.height * zoom) / 2),
  );
  return {
    x: panAxis(
      viewport.x,
      bounds.x * zoom,
      bounds.width * zoom,
      width,
      paddingX,
    ),
    y: panAxis(
      viewport.y,
      bounds.y * zoom,
      bounds.height * zoom,
      height,
      verticalPadding,
    ),
    zoom,
  };
}

export function BehaviourViewport({
  rootId,
  wide,
  fitRequest,
  hasExpandedSteps,
  reveal,
  selectedId,
  nodeCount,
  userMoved,
}: BehaviourView & {
  selectedId: string | null;
  nodeCount: number;
  userMoved: RefObject<boolean>;
}) {
  const flow = useReactFlow();
  const width = useStore((state) => state.width);
  const height = useStore((state) => state.height);
  const renderedCount = useStore((state) => state.nodes.length);
  const measured = useNodesInitialized();
  const previousFrame = useRef<
    | {
        wide: boolean;
        width: number;
        height: number;
        reveal: Reveal | null;
        fitRequest: number;
      }
    | undefined
  >(undefined);
  const placed = useRef<Viewport | null>(null);

  useEffect(() => {
    if (
      !measured ||
      !flow.viewportInitialized ||
      renderedCount !== nodeCount ||
      width <= 0 ||
      height <= 0
    )
      return;

    const frame = requestAnimationFrame(() => {
      const nodes = flow.getNodes();
      if (!nodes.length) return;
      const root = flow.getNode(rootId)?.id ?? nodes[0]!.id;
      const previous = previousFrame.current;
      const breakpointChanged = !!previous && previous.wide !== wide;
      const newRequest = reveal !== previous?.reveal;
      const resized =
        breakpointChanged ||
        (!!previous &&
          (width !== previous.width || height !== previous.height));
      const layoutChanged = fitRequest !== (previous?.fitRequest ?? 0);
      const current = flow.getViewport();
      const last = placed.current;
      // Pressing a locked card starts a pan gesture even when the view stays put.
      if (
        layoutChanged ||
        (last &&
          Math.abs(current.x - last.x) < 1 &&
          Math.abs(current.y - last.y) < 1 &&
          Math.abs(current.zoom - last.zoom) < 1e-3)
      )
        userMoved.current = false;
      const keepExpandedFitted = hasExpandedSteps && !userMoved.current;
      // Opening or closing the details panel resizes the canvas; refit unless
      // the reader has positioned the view themselves.
      const refit = resized && !userMoved.current;
      const autoFit =
        !previous ||
        layoutChanged ||
        (breakpointChanged && !userMoved.current) ||
        refit;
      previousFrame.current = { wide, width, height, reveal, fitRequest };
      let viewport = current;

      if (autoFit) {
        const bounds = flow.getNodesBounds(nodes);
        const fit = getViewportForBounds(
          bounds,
          width,
          height,
          minZoom,
          behaviourFitOptions.maxZoom,
          { x: `${paddingX}px`, top: `${paddingY}px`, bottom: "20px" },
        );
        const focus = (selectedId && flow.getNode(selectedId)?.id) || root;
        viewport =
          layoutChanged ||
          keepExpandedFitted ||
          fit.zoom >= (refit ? refitMinimum : readableMinimum)
            ? fit
            : revealBounds(
                getViewportForBounds(
                  bounds,
                  width,
                  height,
                  readableMinimum,
                  readableMinimum,
                  0,
                ),
                flow.getNodesBounds([focus]),
                width,
                height,
              );
      } else {
        const diagram = resized ? flow.getNodesBounds(nodes) : null;
        if (
          diagram &&
          diagram.width * current.zoom <= width - paddingX * 2 &&
          diagram.height * current.zoom <= height - minimumPaddingY * 2
        ) {
          viewport = revealBounds(current, diagram, width, height);
        } else {
          const target =
            (resized && selectedId) ||
            (newRequest && reveal?.id) ||
            (breakpointChanged && root);
          if (target && flow.getNode(target))
            viewport = revealBounds(
              current,
              flow.getNodesBounds([target]),
              width,
              height,
            );
        }
      }

      if (
        viewport.x !== current.x ||
        viewport.y !== current.y ||
        viewport.zoom !== current.zoom
      )
        void flow.setViewport(viewport);
      placed.current = viewport;
    });
    return () => cancelAnimationFrame(frame);
  }, [
    flow,
    fitRequest,
    hasExpandedSteps,
    height,
    measured,
    nodeCount,
    renderedCount,
    reveal,
    rootId,
    selectedId,
    userMoved,
    wide,
    width,
  ]);

  return null;
}
