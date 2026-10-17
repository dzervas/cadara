import typia from "typia";
import type {
  StlExportOptions,
  StepExportOptions,
  ThreeMfExportOptions,
  SketchVectorExportOptions,
} from "./options";
import { requireContract } from "@/contracts/shared/validation";

const stl = typia.createValidateEquals<StlExportOptions>();
const step = typia.createValidateEquals<StepExportOptions>();
const threeMf = typia.createValidateEquals<ThreeMfExportOptions>();
const vector = typia.createValidateEquals<SketchVectorExportOptions>();

/** The same closed provider options apply to browser and headless exports. */
export function requireGeometryExportOptions(
  format: "stl" | "step" | "3mf" | "svg" | "dxf",
  value: unknown,
): void {
  if (format === "step") {
    requireContract(step, value, "STEP export options");
    return;
  }
  if (format === "svg" || format === "dxf") {
    requireContract(vector, value, "Sketch vector export options");
    return;
  }
  const options =
    format === "stl"
      ? requireContract(stl, value, "STL export options")
      : requireContract(threeMf, value, "3MF export options");
  if (
    !Object.values(options.meshAccuracy).every(
      (n) => Number.isFinite(n) && n > 0,
    )
  )
    throw new Error(
      "Mesh accuracy tolerances must be positive finite numbers.",
    );
}
