/**
 * Minimal Onshape REST client for capture.
 *
 * - HTTP Basic auth from injected credentials (never logged or embedded).
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
  text: () => Promise<string>;
}

export interface OnshapeClientOptions {
  baseUrl: string;
  accessKey: string;
  secretKey: string;
  fetch: FetchLike;
  sleep: (ms: number) => Promise<void>;
  /** Max in-flight requests (default 2). */
  concurrency?: number;
  /** Retry budget for 429/5xx (default 4). */
  maxRetries?: number;
}

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

export class OnshapeClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly fetch: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(options: OnshapeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.authHeader =
      "Basic " + toBase64(`${options.accessKey}:${options.secretKey}`);
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
    let attempt = 0;

    for (;;) {
      const response = await this.fetch(url, {
        method,
        headers: {
          Authorization: this.authHeader,
          Accept: "application/json;charset=UTF-8; qs=0.09",
          ...(body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        },
        body,
      });

      if (response.ok) {
        return response.text();
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < this.maxRetries) {
        const delay = 250 * 2 ** attempt;
        attempt += 1;
        await this.sleep(delay);
        continue;
      }

      const detail = await this.safeErrorDetail(response);
      throw new OnshapeRequestError(response.status, url, detail);
    }
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
