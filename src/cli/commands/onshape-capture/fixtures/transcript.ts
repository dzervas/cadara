/**
 * Recorded Onshape API transcript for capture tests.
 *
 * These are pruned, checked-in fixtures derived from the shape of the original
 * spike captures (feature list, solved sketches, parts, feature specs) plus
 * authored FeatureScript-eval, tessellation, and STEP-translation responses the
 * spike never recorded. Proprietary geometry has been reduced to the minimum
 * needed to exercise every capture code path. No live captures are checked in.
 */
import type {
  FetchLike,
  FetchResponse,
} from "@/cli/commands/onshape-capture/client";

/** Re-exported response shape so tests can author override responses. */
export type FetchResponseStub = FetchResponse;

export const FIXTURE_DOCUMENT_ID = "40a51fb8fa82fd4565151114";
export const FIXTURE_WVM = "w";
export const FIXTURE_WVM_ID = "a14bbd18c43e1cd99d2cfc48";
export const FIXTURE_MICROVERSION = "c34b869c9f096a9a8bf455e6";
export const FIXTURE_PART_STUDIO_ID = "865452a3e2270f0ebca3ce63";
export const FIXTURE_EMPTY_STUDIO_ID = "00f6d47c1d4c79c1000000eb";
export const FIXTURE_ASSEMBLY_ID = "00f6d47c1d4c79c1d5ad060b";

export const FIXTURE_DOCUMENT_URL = `https://cad.onshape.com/documents/${FIXTURE_DOCUMENT_ID}/${FIXTURE_WVM}/${FIXTURE_WVM_ID}`;
export const FIXTURE_ELEMENT_URL = `${FIXTURE_DOCUMENT_URL}/e/${FIXTURE_PART_STUDIO_ID}`;

/** A pruned `getFeatures` response with three referenced deterministic IDs. */
const FEATURES_WITH_REFERENCES = {
  btType: "BTFeatureListResponse-2457",
  serializationVersion: "1.2.20",
  sourceMicroversion: FIXTURE_MICROVERSION,
  isComplete: true,
  features: [
    {
      btType: "BTMFeature-134",
      featureType: "newSketch",
      featureId: "FOoap8tw3jKAJf5_0",
      name: "Sketch 1",
      parameters: [
        {
          btType: "BTMParameterQueryList-148",
          parameterId: "sketchPlane",
          queries: [
            {
              btType: "BTMIndividualQuery-138",
              deterministicIds: ["JDC"],
              queryString: "query=qCompressed(...TopplaneOp...);",
            },
          ],
        },
      ],
    },
    {
      btType: "BTMFeature-134",
      featureType: "extrude",
      featureId: "FG094ehBlsq34dl_0",
      name: "Extrude 1",
      parameters: [
        {
          btType: "BTMParameterQueryList-148",
          parameterId: "entities",
          queries: [
            {
              btType: "BTMIndividualSketchRegionQuery-140",
              deterministicIds: ["JGC"],
              queryString: 'query = qSketchRegion(id + "FOoap8tw3jKAJf5_0", true);',
            },
          ],
        },
        {
          btType: "BTMParameterEnum-145",
          parameterId: "endBound",
          enumName: "BoundingType",
          value: "BLIND",
        },
        {
          btType: "BTMParameterQuantity-147",
          parameterId: "depth",
          expression: "10 mm",
          value: 0.01,
        },
        {
          btType: "BTMParameterEnum-145",
          parameterId: "operationType",
          enumName: "NewBodyOperationType",
          value: "NEW",
        },
      ],
    },
    {
      btType: "BTMSketch-151",
      featureType: "newSketch",
      featureId: "FkkBVfXRKopMlIW_1",
      name: "Sketch 2",
      constraints: [
        {
          btType: "BTMSketchConstraint-2",
          parameters: [
            {
              btType: "BTMParameterQueryList-148",
              parameterId: "externalQuery",
              queries: [
                {
                  btType: "BTMIndividualQuery-138",
                  deterministicIds: ["ZZZ"],
                  queryString: "query=qCompressed(...SWEPT_FACE...);",
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

/** A pruned feature list with no deterministic references (empty studio). */
const FEATURES_NO_REFERENCES = {
  btType: "BTFeatureListResponse-2457",
  serializationVersion: "1.2.20",
  sourceMicroversion: FIXTURE_MICROVERSION,
  isComplete: true,
  features: [],
};

const SKETCHES_RESPONSE = {
  jsonType: "sketchInfo",
  sketches: [
    {
      // Real Onshape solved-sketch shape: a closed circle on the Top (XY) datum
      // at the world origin, so the importer can translate, project, and solve
      // it into a usable region. Positions are in meters.
      featureId: "FOoap8tw3jKAJf5_0",
      name: "Sketch 1",
      sketchSolveStatus: "WELL_DEFINED",
      entities: [
        {
          jsonType: "BTSketchCurveSegmentInfo",
          sketchEntityId: "circle1",
          sketchEntityType: "skCircle",
          isConstruction: false,
          centerId: "circle1.center",
          geometry: {
            btType: "BTCurveGeometryCircle-115",
            center3d: { btType: "BTVector3d-389", x: 0, y: 0, z: 0 },
            radius: 0.005,
            clockWise: false,
          },
        },
      ],
    },
  ],
  unreportedSketches: [],
};

const PARTS_RESPONSE = [
  {
    name: "Part 1",
    partId: "JHD",
    elementId: FIXTURE_PART_STUDIO_ID,
    bodyType: "solid",
    microversionId: FIXTURE_MICROVERSION,
  },
];

const FEATURESPECS_RESPONSE = {
  btType: "BTFeatureSpecResponse",
  serializationVersion: "1.2.20",
  sourceMicroversion: FIXTURE_MICROVERSION,
  featureSpecs: [{ featureType: "extrude" }, { featureType: "newSketch" }],
};

const TESSELLATED_FACES_RESPONSE = {
  bodies: [
    {
      id: "JHD",
      faces: [
        {
          id: "face1",
          facets: [{ vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0]] }],
        },
      ],
    },
  ],
};

const STEP_TEXT = "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n";

// Entity records the resolution FeatureScript returns natively. JDC and JGC are
// present in the final state; ZZZ was consumed mid-history and is absent (so it
// must resolve to an explicit unresolved record).
const ENTITY_RECORDS = [
  {
    id: "JDC",
    entityClass: "face",
    geometryType: "PLANE",
    box: [0, 0, 0, 0.05, 0.05, 0],
    origin: [0, 0, 0],
    normal: [0, 0, 1],
  },
  {
    id: "JGC",
    entityClass: "face",
    geometryType: "CYLINDER",
    box: [0, 0, 0, 0.05, 0.05, 0.01],
    radius: 0.005,
  },
];

// Encode a plain JS value as Onshape's BTFSValue tree, mirroring what the eval
// endpoint returns (map -> object, array -> array, scalar -> value).
function fsEncode(value: unknown): unknown {
  if (typeof value === "number") {
    return {
      btType: "com.belmonttech.serialize.fsvalue.BTFSValueNumber",
      typeTag: "",
      value,
    };
  }
  if (typeof value === "string") {
    return {
      btType: "com.belmonttech.serialize.fsvalue.BTFSValueString",
      typeTag: "",
      value,
    };
  }
  if (Array.isArray(value)) {
    return {
      btType: "com.belmonttech.serialize.fsvalue.BTFSValueArray",
      typeTag: "",
      value: value.map(fsEncode),
    };
  }
  if (value && typeof value === "object") {
    return {
      btType: "com.belmonttech.serialize.fsvalue.BTFSValueMap",
      typeTag: "",
      value: Object.entries(value).map(([key, entryValue]) => ({
        btType: "BTFSValueMapEntry-2077",
        key: fsEncode(key),
        value: fsEncode(entryValue),
      })),
    };
  }
  return {
    btType: "com.belmonttech.serialize.fsvalue.BTFSValueString",
    typeTag: "",
    value: String(value),
  };
}

const FEATURESCRIPT_RESPONSE = {
  btType: "BTFeatureScriptEvalResponse-1859",
  result: fsEncode(ENTITY_RECORDS),
  notices: [],
};

function json(status: number, body: unknown): FetchResponse {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  };
}

/** A single recorded route: method + URL predicate + response factory. */
export interface FixtureRoute {
  method: "GET" | "POST";
  match: (url: string) => boolean;
  respond: () => FetchResponse;
}

function includes(fragment: string): (url: string) => boolean {
  return (url) => url.includes(fragment);
}

/** Build the default happy-path route table for the fixture document. */
export function buildDefaultRoutes(): FixtureRoute[] {
  return [
    {
      method: "GET",
      match: (url) =>
        url.endsWith(`/documents/${FIXTURE_DOCUMENT_ID}`),
      respond: () => json(200, { jsonType: "document", name: "Mounts" }),
    },
    {
      method: "GET",
      match: includes("/currentmicroversion"),
      respond: () => json(200, { microversion: FIXTURE_MICROVERSION }),
    },
    {
      method: "GET",
      match: includes("/elements"),
      respond: () =>
        json(200, [
          {
            id: FIXTURE_PART_STUDIO_ID,
            name: "Mounts",
            elementType: "PARTSTUDIO",
          },
          {
            id: FIXTURE_EMPTY_STUDIO_ID,
            name: "Empty",
            elementType: "PARTSTUDIO",
          },
          {
            id: FIXTURE_ASSEMBLY_ID,
            name: "Assembly 1",
            elementType: "ASSEMBLY",
          },
        ]),
    },
    // Part Studio A (has bodies + references)
    {
      method: "GET",
      match: (url) =>
        url.endsWith(`/e/${FIXTURE_PART_STUDIO_ID}/features`),
      respond: () => json(200, FEATURES_WITH_REFERENCES),
    },
    {
      method: "GET",
      match: (url) =>
        url.includes(`/e/${FIXTURE_PART_STUDIO_ID}/sketches`),
      respond: () => json(200, SKETCHES_RESPONSE),
    },
    {
      method: "GET",
      match: (url) =>
        url.includes(`/parts/`) && url.includes(`/e/${FIXTURE_PART_STUDIO_ID}`),
      respond: () => json(200, PARTS_RESPONSE),
    },
    {
      method: "GET",
      match: (url) =>
        url.includes(`/e/${FIXTURE_PART_STUDIO_ID}/featurespecs`),
      respond: () => json(200, FEATURESPECS_RESPONSE),
    },
    {
      method: "POST",
      match: (url) =>
        url.includes(`/e/${FIXTURE_PART_STUDIO_ID}/featurescript`),
      respond: () => json(200, FEATURESCRIPT_RESPONSE),
    },
    {
      method: "GET",
      match: (url) =>
        url.includes(`/e/${FIXTURE_PART_STUDIO_ID}/tessellatedfaces`),
      respond: () => json(200, TESSELLATED_FACES_RESPONSE),
    },
    {
      method: "POST",
      match: (url) =>
        url.includes(`/e/${FIXTURE_PART_STUDIO_ID}/translations`),
      respond: () =>
        json(200, { id: "translation-1", requestState: "ACTIVE" }),
    },
    // Part Studio B (empty)
    {
      method: "GET",
      match: (url) => url.endsWith(`/e/${FIXTURE_EMPTY_STUDIO_ID}/features`),
      respond: () => json(200, FEATURES_NO_REFERENCES),
    },
    {
      method: "GET",
      match: (url) => url.includes(`/e/${FIXTURE_EMPTY_STUDIO_ID}/sketches`),
      respond: () => json(200, { jsonType: "sketchInfo", sketches: [] }),
    },
    {
      method: "GET",
      match: (url) =>
        url.includes(`/parts/`) && url.includes(`/e/${FIXTURE_EMPTY_STUDIO_ID}`),
      respond: () => json(200, []),
    },
    {
      method: "GET",
      match: (url) => url.includes(`/e/${FIXTURE_EMPTY_STUDIO_ID}/featurespecs`),
      respond: () => json(200, FEATURESPECS_RESPONSE),
    },
    // Translation polling + external data (shared)
    {
      method: "GET",
      match: includes("/translations/translation-1"),
      respond: () =>
        json(200, {
          requestState: "DONE",
          resultExternalDataIds: ["ext-step-1"],
        }),
    },
    {
      method: "GET",
      match: includes("/externaldata/ext-step-1"),
      respond: () => json(200, STEP_TEXT),
    },
  ];
}

/** A fetch spy that records every call it serves. */
export interface FixtureFetch {
  fetch: FetchLike;
  calls: Array<{ method: string; url: string }>;
}

/**
 * Build a fixture fetch from a route table. Earlier routes win, so tests can
 * prepend override routes (failures, rate limits) ahead of the defaults.
 */
export function createFixtureFetch(
  routes: FixtureRoute[] = buildDefaultRoutes(),
): FixtureFetch {
  const calls: Array<{ method: string; url: string }> = [];
  const fetch: FetchLike = (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url });
    const route = routes.find(
      (candidate) => candidate.method === method && candidate.match(url),
    );
    if (!route) {
      return Promise.resolve(json(404, { message: `no fixture for ${method} ${url}` }));
    }
    return Promise.resolve(route.respond());
  };
  return { fetch, calls };
}

/** A runtime helper for capture tests: instant sleep, fixed clock. */
export function createFixtureRuntime(fetch: FetchLike) {
  return {
    fetch,
    sleep: () => Promise.resolve(),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    cliVersion: "0.0.1-test",
  };
}
