/**
 * Minimal Onshape REST client for capture.
 *
 * - HTTP Basic or `on` cookie auth from injected credentials (never logged or embedded).
 * - Injected `fetch` and `sleep` so tests run against recorded transcripts.
 * - Bounded concurrency and exponential backoff on HTTP 429/5xx.
 * - Errors carry the URL and status but never authorization material.
 */

/** Injected fetch signature (a subset of the WHATWG `fetch`). */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<FetchResponse>;

export interface FetchResponse {
  ok: boolean;
  status: number;
  headers?: {
    get(name: string): string | null;
    getSetCookie?: () => string[];
  };
  text: () => Promise<string>;
}

export type OnshapeCredentials =
  | { cookieOn: string; accessKey?: never; secretKey?: never }
  | { cookieOn?: never; accessKey: string; secretKey: string };

export type OnshapeClientOptions = OnshapeCredentials & {
  baseUrl: string;
  fetch: FetchLike;
  sleep: (ms: number) => Promise<void>;
  /** Max in-flight requests (default 2). */
  concurrency?: number;
  /** Retry budget for 429/5xx (default 4). */
  maxRetries?: number;
};

/** An HTTP failure that intentionally excludes credential material. */
export class OnshapeRequestError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(status: number, url: string, detail: string) {
    super(`${url} → HTTP ${status}${detail ? `\n${detail}` : ""}`);
    this.name = "OnshapeRequestError";
    this.status = status;
    this.url = url;
  }
}

function toBase64(value: string): string {
  // Available in both Bun and Node runtimes.
  return Buffer.from(value, "utf8").toString("base64");
}

function serializeOnCookie(value: string): string {
  return value.startsWith("on=") ? value : `on=${value}`;
}

interface XsrfCredential {
  cookieName: string;
  headerName: string;
  value: string;
}

function readSetCookie(response: FetchResponse, name: string): string | null {
  const headers = response.headers?.getSetCookie?.() ?? [response.headers?.get("set-cookie") ?? ""];
  const marker = `${name}=`;
  for (const header of headers) {
    const start = header.indexOf(marker);
    if (start < 0) continue;
    const valueStart = start + marker.length;
    const valueEnd = header.indexOf(";", valueStart);
    return header.slice(valueStart, valueEnd < 0 ? undefined : valueEnd);
  }
  return null;
}

export class OnshapeClient {
  private readonly baseUrl: string;
  private readonly credentialHeader: Record<string, string>;
  private readonly cookieHeader: string | null;
  private readonly fetch: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private xsrfCredential: Promise<XsrfCredential> | null = null;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(options: OnshapeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.cookieHeader = options.cookieOn !== undefined
      ? serializeOnCookie(options.cookieOn)
      : null;
    this.credentialHeader = this.cookieHeader !== null
      ? { Cookie: this.cookieHeader }
      : { Authorization: "Basic " + toBase64(`${options.accessKey}:${options.secretKey}`) };
    this.fetch = options.fetch;
    this.sleep = options.sleep;
    this.concurrency = Math.max(1, options.concurrency ?? 2);
    this.maxRetries = Math.max(0, options.maxRetries ?? 4);
  }

  /** GET a JSON endpoint (path relative to the API base URL). */
  async getJson(path: string): Promise<unknown> {
    const text = await this.request("GET", path);
    return JSON.parse(text);
  }

  /** POST a JSON body and parse the JSON response. */
  async postJson(path: string, body: unknown): Promise<unknown> {
    const text = await this.request("POST", path, JSON.stringify(body));
    return JSON.parse(text);
  }

  /** DELETE an endpoint, ignoring any response body. */
  async delete(path: string): Promise<void> {
    await this.request("DELETE", path);
  }

  /** GET raw text (e.g. an exported STEP document). */
  async getText(path: string): Promise<string> {
    return this.request("GET", path);
  }

  private async request(
    method: string,
    path: string,
    body?: string,
  ): Promise<string> {
    await this.acquire();
    try {
      return await this.requestWithRetry(method, path, body);
    } finally {
      this.release();
    }
  }

  private async requestWithRetry(
    method: string,
    path: string,
    body: string | undefined,
  ): Promise<string> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const response = await this.fetchWithRetry(
      url,
      method,
      {
        ...(await this.requestCredentialHeader(method)),
        Accept: "application/json;charset=UTF-8; qs=0.09",
        ...(body === undefined
          ? {}
          : { "Content-Type": "application/json" }),
      },
      body,
    );
    return response.text();
  }

  private async fetchWithRetry(
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<FetchResponse> {
    let attempt = 0;
    for (;;) {
      const response = await this.fetch(url, { method, headers, body });
      if (response.ok) return response;

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        const delay = this.retryDelay(response, attempt);
        attempt += 1;
        await this.sleep(delay);
        continue;
      }

      const detail = await this.safeErrorDetail(response);
      throw new OnshapeRequestError(response.status, url, detail);
    }
  }

  private async requestCredentialHeader(method: string): Promise<Record<string, string>> {
    if (this.cookieHeader === null || (method !== "POST" && method !== "DELETE")) {
      return this.credentialHeader;
    }
    this.xsrfCredential ??= this.loadXsrfCredential();
    const xsrf = await this.xsrfCredential;
    return {
      Cookie: `${this.cookieHeader}; ${xsrf.cookieName}=${xsrf.value}`,
      [xsrf.headerName]: xsrf.value,
    };
  }

  private async loadXsrfCredential(): Promise<XsrfCredential> {
    const url = `${new URL(this.baseUrl).origin}/api/clientinfo/xsrf`;
    const response = await this.fetchWithRetry(
      url,
      "GET",
      {
        ...this.credentialHeader,
        Accept: "application/json;charset=UTF-8; qs=0.09",
      },
    );
    let data: unknown;
    try {
      data = JSON.parse(await response.text());
    } catch {
      throw new Error("Onshape XSRF bootstrap returned invalid JSON.");
    }
    const names = data as { xsrfTokenName?: unknown; xsrfHeaderName?: unknown };
    if (typeof names.xsrfTokenName !== "string" || typeof names.xsrfHeaderName !== "string") {
      throw new Error("Onshape XSRF bootstrap omitted its cookie or header name.");
    }
    const value = readSetCookie(response, names.xsrfTokenName);
    if (!value) {
      throw new Error(`Onshape XSRF bootstrap did not issue the ${names.xsrfTokenName} cookie.`);
    }
    return {
      cookieName: names.xsrfTokenName,
      headerName: names.xsrfHeaderName,
      value,
    };
  }

  private retryDelay(response: FetchResponse, attempt: number): number {
    if (response.status !== 429) return 250 * 2 ** attempt;

    const retryAfter = response.headers?.get("retry-after");
    if (retryAfter !== undefined && retryAfter !== null && retryAfter.trim() !== "") {
      const seconds = Number(retryAfter);
      if (Number.isFinite(seconds) && seconds >= 0) {
        return Math.min(seconds * 1_000, 300_000);
      }
    }

    return Math.min(15_000 * 2 ** attempt, 60_000);
  }

  private async safeErrorDetail(response: FetchResponse): Promise<string> {
    try {
      return (await response.text()).slice(0, 500);
    } catch {
      return "";
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.concurrency) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.waiters.push(() => {
        this.active += 1;
        resolve();
      });
    });
  }

  private release(): void {
    this.active -= 1;
    const next = this.waiters.shift();
    if (next) {
      next();
    }
  }
}
