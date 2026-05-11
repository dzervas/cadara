import { z } from "zod";

import type {
  SketchPlaneDefinition,
  SketchPlaneFrame,
  SketchPlaneSupportRef,
} from "@/contracts/shared/sketch-plane";
import {
  constructionRefSchema,
  faceRefSchema,
} from "@/contracts/shared/references.runtime-schema";
import { point3dSchema } from "@/contracts/shared/runtime-schema";

export const sketchPlaneFrameSchema = z
  .object({
    origin: point3dSchema,
    xAxis: point3dSchema,
    yAxis: point3dSchema,
    normal: point3dSchema,
    linearUnit: z.literal("documentLength"),
    handedness: z.literal("rightHanded"),
  })
  .transform((value) => value as SketchPlaneFrame);

export const sketchPlaneSupportRefSchema = z
  .union([constructionRefSchema, faceRefSchema])
  .transform((value) => value as SketchPlaneSupportRef);

export const sketchPlaneDefinitionSchema = z
  .object({
    support: sketchPlaneSupportRefSchema,
    frame: sketchPlaneFrameSchema,
    key: z
      .union([z.literal("xy"), z.literal("yz"), z.literal("xz")])
      .nullable(),
  })
  .transform((value) => value as SketchPlaneDefinition);
