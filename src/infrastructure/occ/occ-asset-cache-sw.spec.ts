import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { expect, test } from "vitest";

import {
  OCC_ASSET_VERSION,
  getVersionedOpenCascadeRuntimeAssetUrls,
} from "@/domain/modeling/occ/assets";
import {
  APP_WORKER_ASSET_URLS,
  getOpenCascadeServiceWorkerUrl,
  registerOpenCascadeAssetCache,
} from "@/infrastructure/occ/asset-cache";

// Lane: ui (src/infrastructure/occ, docs/testing.md). Seam: the shipped
// service worker script (`public/occ-asset-cache-sw.js`) as the browser
// drives it: registered with the URL the app builds, then its install,
// activate and fetch handlers, over an in-memory Cache Storage and network.

const ORIGIN = "https://cadara.test";
const SOURCE = readFileSync(
  join(process.cwd(), "public/occ-asset-cache-sw.js"),
  "utf8",
);

type Handler = (event: Record<string, unknown>) => void;

/** Loads the service worker as registered at `scriptUrl`. */
function loadServiceWorker(
  scriptUrl: string,
  initialCaches: Record<string, Record<string, string>> = {},
) {
  const storage = new Map<string, Map<string, Response>>(
    Object.entries(initialCaches).map(([name, entries]) => [
      name,
      new Map(
        Object.entries(entries).map(([url, body]) => [url, new Response(body)]),
      ),
    ]),
  );
  const network: string[] = [];
  let online = true;
  const fetchLike = async (input: Request | string) => {
    const url = new URL(
      typeof input === "string" ? input : input.url,
      ORIGIN,
    ).toString();
    network.push(url);
    if (!online) throw new TypeError("Failed to fetch");
    return new Response(`network ${url}`);
  };
  const urlOf = (request: Request | string) =>
    new URL(
      typeof request === "string" ? request : request.url,
      ORIGIN,
    ).toString();
  const cacheStorage = {
    async open(name: string) {
      const entries = storage.get(name) ?? new Map<string, Response>();
      storage.set(name, entries);
      return {
        async match(request: Request | string) {
          return entries.get(urlOf(request))?.clone();
        },
        async put(request: Request | string, response: Response) {
          entries.set(urlOf(request), response);
        },
        async add(request: string) {
          entries.set(urlOf(request), await fetchLike(request));
        },
        async addAll(requests: string[]) {
          for (const request of requests)
            entries.set(urlOf(request), await fetchLike(request));
        },
      };
    },
    async keys() {
      return [...storage.keys()];
    },
    async delete(name: string) {
      return storage.delete(name);
    },
  };
  const handlers = new Map<string, Handler>();
  const self = {
    location: new URL(scriptUrl, ORIGIN),
    addEventListener: (type: string, handler: Handler) =>
      handlers.set(type, handler),
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  };
  runInNewContext(SOURCE, {
    self,
    caches: cacheStorage,
    fetch: fetchLike,
    URL,
  });

  async function lifecycle(type: "install" | "activate") {
    const pending: Promise<unknown>[] = [];
    handlers.get(type)!({
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    await Promise.all(pending);
  }
  /** Dispatches a fetch; the response, or null when not intercepted. */
  async function request(path: string, method = "GET") {
    let responded: Promise<Response> | null = null;
    handlers.get("fetch")!({
      request: new Request(new URL(path, ORIGIN), { method }),
      respondWith: (response: Promise<Response>) => {
        responded = response;
      },
    });
    return responded
      ? await (responded as Promise<Response>).then((r) => r.text())
      : null;
  }
  const cached = (name: string) => [...(storage.get(name)?.keys() ?? [])];
  return {
    storage,
    network,
    goOffline: () => {
      online = false;
    },
    lifecycle,
    request,
    cached,
  };
}

const WORKERS = [
  "/assets/worker-AAAA.js",
  "/assets/sketch-derivation.worker-BBBB.js",
  "/assets/document-sync.worker-CCCC.js",
];
const appCacheName = (paths: readonly string[]) =>
  `cadara-app-assets-${paths.join(",")}`;
const occCacheName = `cadara-occ-assets-opencascade-2.0.0-beta.b5ff984-${OCC_ASSET_VERSION}`;

test("the app registers the service worker with the OCC version and its three worker bundles to precache; without bundles the URL is the OCC-only one", async () => {
  let registered = "";
  await registerOpenCascadeAssetCache({
    serviceWorker: {
      register: async (url: string | URL) => {
        registered = String(url);
        return null as unknown as ServiceWorkerRegistration;
      },
    } as unknown as ServiceWorkerContainer,
  });
  const url = new URL(registered, ORIGIN);
  expect(url.pathname).toBe("/occ-asset-cache-sw.js");
  expect(url.searchParams.get("v")).toBe(OCC_ASSET_VERSION);
  expect(url.searchParams.get("precache")?.split(",")).toEqual([
    ...APP_WORKER_ASSET_URLS,
  ]);
  expect(
    new Set(APP_WORKER_ASSET_URLS).size,
    "the three worker bundles the app spawns (occ, sketch derivation, document sync)",
  ).toBe(3);
  expect(
    new URL(getOpenCascadeServiceWorkerUrl(WORKERS), ORIGIN).searchParams
      .get("precache")
      ?.split(","),
  ).toEqual(WORKERS);
  expect(getOpenCascadeServiceWorkerUrl()).toBe(
    `/occ-asset-cache-sw.js?v=${OCC_ASSET_VERSION}`,
  );
});

test("install precaches exactly the listed same-origin /assets/ bundles, so a worker never fetched before loads offline from the cache", async () => {
  const listed = [
    ...WORKERS,
    "/index.html",
    "/assets/nested/x.js",
    "https://elsewhere.test/assets/y.js",
  ];
  const sw = loadServiceWorker(getOpenCascadeServiceWorkerUrl(listed));
  await sw.lifecycle("install");
  await sw.lifecycle("activate");
  expect(sw.cached(appCacheName(WORKERS))).toEqual(
    WORKERS.map((path) => `${ORIGIN}${path}`),
  );

  sw.goOffline();
  const before = sw.network.length;
  expect(await sw.request(WORKERS[1]!)).toBe(`network ${ORIGIN}${WORKERS[1]}`);
  expect(sw.network.length, "served without the network").toBe(before);
  // Other files are not intercepted (the browser handles them as before).
  expect(await sw.request("/assets/index-DDDD.js")).toBeNull();
  expect(await sw.request("/index.html")).toBeNull();
  expect(await sw.request(WORKERS[0]!, "POST")).toBeNull();
});

test("install precaches the versioned kernel runtime (the URLs the app requests) into the OCC cache, once per version, and serves it offline; other OCC URLs keep their cache-on-fetch", async () => {
  const kernel = Object.values(getVersionedOpenCascadeRuntimeAssetUrls()).map(
    (url) => {
      const parsed = new URL(url);
      return `${parsed.pathname}${parsed.search}`;
    },
  );
  expect(kernel).toEqual([
    `/cadara-occ.js?v=${OCC_ASSET_VERSION}`,
    `/cadara-occ.wasm?v=${OCC_ASSET_VERSION}`,
  ]);
  const sw = loadServiceWorker(getOpenCascadeServiceWorkerUrl(WORKERS));
  await sw.lifecycle("install");
  await sw.lifecycle("activate");
  expect(sw.cached(occCacheName)).toEqual(
    kernel.map((path) => `${ORIGIN}${path}`),
  );

  // An unlisted OCC URL: fetched once, then cached (unchanged behaviour).
  expect(await sw.request("/cadara-occ.wasm")).toBe(
    `network ${ORIGIN}/cadara-occ.wasm`,
  );
  expect(sw.cached(occCacheName)).toContain(`${ORIGIN}/cadara-occ.wasm`);

  sw.goOffline();
  const before = sw.network.length;
  for (const path of [...kernel, "/cadara-occ.wasm"])
    expect(await sw.request(path)).toBe(`network ${ORIGIN}${path}`);
  expect(sw.network.length, "served without the network").toBe(before);

  // A later install of the same OCC version (another app build) does not
  // download the kernel again.
  const update = loadServiceWorker(
    getOpenCascadeServiceWorkerUrl(["/assets/x-1.js"]),
    {
      [occCacheName]: Object.fromEntries(
        kernel.map((path) => [`${ORIGIN}${path}`, "cached"]),
      ),
    },
  );
  await update.lifecycle("install");
  expect(update.network).toEqual([`${ORIGIN}/assets/x-1.js`]);
});

test("activation of a build with other bundles drops the previous bundles' cache and stale OCC caches, keeping current and unrelated caches", async () => {
  const previous = ["/assets/worker-OLD.js"];
  const sw = loadServiceWorker(getOpenCascadeServiceWorkerUrl(WORKERS), {
    [appCacheName(previous)]: { [`${ORIGIN}${previous[0]}`]: "old" },
    "cadara-occ-assets-opencascade-2.0.0-beta.b5ff984-old": {},
    [occCacheName]: { [`${ORIGIN}/cadara-occ.js`]: "occ" },
    "someone-else": {},
  });
  await sw.lifecycle("install");
  await sw.lifecycle("activate");
  expect([...sw.storage.keys()].sort()).toEqual(
    [appCacheName(WORKERS), occCacheName, "someone-else"].sort(),
  );
});
