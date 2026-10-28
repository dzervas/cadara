import { useEffect, useState } from "react";

import type { ErrorReporter } from "@/contracts/errors";
import { ok } from "@/contracts/errors";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { MeasureTopologyResponse } from "@/contracts/modeling/topology-measure";
import { getPrimitiveRefKey, type PrimitiveRef } from "@/core/editor/schema";
import { getTopologyMeasureTargets } from "@/core/measure/measurement";
import type { ModelingService } from "@/application/modeling/modeling-service";
import { runReportedAction } from "@/lib/reported-action";

/**
 * The kernel's exact measures of the measured body topology (cadara-h026.5):
 * asked for when the readout's targets or the revision change, for the
 * body, face and edge targets the readout measures (cadara-h026.3: the
 * Measure tool's two picks or a plain selection, bounded by
 * `getTopologyMeasureTargets`). Null
 * until they arrive; the readout shows mesh values, marked approximate,
 * meanwhile. Requests are keyed by revision and target keys, so a new
 * selection array with the same targets (a level-of-detail refinement) does
 * not ask again.
 */
export function useTopologyMeasures(input: {
  enabled: boolean;
  modelingService: Pick<ModelingService, "measureTopology">;
  snapshot: WorkspaceSnapshot | null;
  /** The targets the readout measures. */
  selection: readonly PrimitiveRef[];
  errorReporter: ErrorReporter;
  showError: (message: string) => void;
}): MeasureTopologyResponse | null {
  const {
    enabled,
    modelingService,
    snapshot,
    selection,
    errorReporter,
    showError,
  } = input;
  const revisionId = snapshot?.document.revisionId ?? null;
  const targets = enabled ? getTopologyMeasureTargets(selection) : [];
  const request = `${revisionId}|${targets.map(getPrimitiveRefKey).join("|")}`;
  // Changes only when the request does (state adjusted during render).
  const [pending, setPending] = useState({ request, revisionId, targets });
  if (pending.request !== request) setPending({ request, revisionId, targets });
  const [measured, setMeasured] = useState<{
    request: string;
    response: MeasureTopologyResponse | null;
  } | null>(null);

  useEffect(() => {
    const { request, revisionId, targets } = pending;
    if (targets.length === 0 || revisionId === null) return;
    let current = true;
    void runReportedAction({
      operation: "Measure",
      reporter: errorReporter,
      context: [{ key: "baseRevisionId", value: revisionId }],
      action: () => modelingService.measureTopology(targets),
      mapSuccess: (response) => ok(response),
      // A superseded request's failure (e.g. after a document switch) is
      // still reported, but not shown.
      onError: (error) => {
        if (current) showError(error.message);
      },
    }).then((result) => {
      if (current && result.isOk())
        setMeasured({ request, response: result.value });
    });
    return () => {
      current = false;
    };
  }, [errorReporter, modelingService, pending, showError]);

  return measured?.request === request ? measured.response : null;
}
