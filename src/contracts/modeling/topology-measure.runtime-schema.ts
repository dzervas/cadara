import typia from "typia";

import type { MeasureTopologyResponse } from "@/contracts/modeling/topology-measure";
import { requireContract } from "@/contracts/shared/validation";

const measureTopologyResponseValidator =
  typia.createValidateEquals<MeasureTopologyResponse>();

/** Validates a kernel's topology measures at the worker transport boundary. */
export function requireMeasureTopologyResponse(
  value: unknown,
): MeasureTopologyResponse {
  return requireContract(
    measureTopologyResponseValidator,
    value,
    "Measure topology response",
  );
}
