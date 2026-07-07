import type { OnshapeGroundTruth } from "@/contracts/import/onshape-capture-bundle";

import type { OnshapeClient } from "@/cli/commands/onshape-capture/client";

/** Default chord tolerance (meters) for final-state tessellation. */
export const DEFAULT_TESSELLATION_TOLERANCE = 0.001;

/** Default translation status poll budget before treating STEP export as failed. */
export const DEFAULT_MAX_TRANSLATION_POLLS = 120;

/**
 * Decide whether a Part Studio produced any solid bodies from its raw parts
 * response.
 */
export function partsHaveBodies(parts: unknown): boolean {
  return Array.isArray(parts) && parts.length > 0;
}

/**
 * Capture final-state ground truth for a Part Studio: tessellated faces plus a
 * STEP export. Empty Part Studios record the absence of bodies explicitly.
 */
export async function captureGroundTruth(
  client: OnshapeClient,
  context: {
    documentId: string;
    wvm: string;
    wvmId: string;
    elementId: string;
    studioPath: string;
    parts: unknown;
    sleep: (ms: number) => Promise<void>;
    maxTranslationPolls?: number;
  },
): Promise<OnshapeGroundTruth> {
  if (!partsHaveBodies(context.parts)) {
    return { hasBodies: false };
  }

  const tolerance = DEFAULT_TESSELLATION_TOLERANCE;
  const tessellatedFaces = await client.getJson(
    `${context.studioPath}/tessellatedfaces?chordTolerance=${tolerance}`,
  );
  const step = await exportStep(client, context);

  return {
    hasBodies: true,
    tessellationTolerance: tolerance,
    tessellatedFaces,
    step,
  };
}

async function exportStep(
  client: OnshapeClient,
  context: {
    documentId: string;
    wvm: string;
    wvmId: string;
    studioPath: string;
    sleep: (ms: number) => Promise<void>;
    maxTranslationPolls?: number;
  },
): Promise<string> {
  const requested = (await client.postJson(`${context.studioPath}/translations`, {
    formatName: "STEP",
    storeInDocument: false,
    flattenAssemblies: false,
  })) as {
    id?: string;
    requestState?: string;
    resultExternalDataIds?: string[];
  };

  let state = requested;
  let polls = 0;
  while (state.requestState !== "DONE") {
    if (state.requestState === "FAILED") {
      throw new Error("Onshape STEP translation reported FAILED.");
    }
    const maxPolls = context.maxTranslationPolls ?? DEFAULT_MAX_TRANSLATION_POLLS;
    if (polls >= maxPolls) {
      throw new Error(
        `Onshape STEP translation did not finish after ${maxPolls} polls.`,
      );
    }
    polls += 1;
    await context.sleep(500);
    state = (await client.getJson(`/translations/${requested.id}`)) as {
      requestState?: string;
      resultExternalDataIds?: string[];
    };
  }

  const externalId = state.resultExternalDataIds?.[0];
  if (!externalId) {
    throw new Error("Onshape STEP translation returned no external data id.");
  }

  return client.getText(
    `/documents/d/${context.documentId}/externaldata/${externalId}`,
  );
}
