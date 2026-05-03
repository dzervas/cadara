# Development Debug Platform

The local Docker workflow now exposes two stable development addresses:

- Frontend app: `http://127.0.0.1:3000` on the host, `http://frontend:3000` from other Compose services.
- Debug browser: `http://127.0.0.1:9222` on the host, `http://debug-browser:3000` from other Compose services.

The `agent` service exports the same endpoints as environment variables:

- `CADARA_DEV_FRONTEND_URL=http://frontend:3000`
- `CADARA_DEV_DEBUG_BROWSER_HTTP_URL=http://debug-browser:3000`
- `CADARA_DEV_DEBUG_BROWSER_WS_URL=ws://debug-browser:3000?token=cadara-local-debug`

## Start The Workflow

Run the local stack:

```bash
docker compose up frontend debug-browser agent
```

The frontend stays on its normal development address. The debug browser is a dedicated Browserless Chromium sidecar and stays outside frontend runtime ownership.

## Attach From An Agent

Containerized agents can connect over CDP to the dedicated browser:

```ts
import { chromium } from "playwright"

const browser = await chromium.connectOverCDP(process.env.CADARA_DEV_DEBUG_BROWSER_WS_URL!)
const context = browser.contexts()[0] ?? await browser.newContext()
const page = context.pages()[0] ?? await context.newPage()
await page.goto(process.env.CADARA_DEV_FRONTEND_URL!)
```

That keeps automation on stable service names inside Compose instead of relying on host-loopback routing.

## Attach From The Host

Humans or host-side tools can use the same sidecar from the host:

- Frontend: `http://127.0.0.1:3000`
- Browserless HTTP endpoint: `http://127.0.0.1:9222`
- Browserless CDP endpoint: `ws://127.0.0.1:9222?token=cadara-local-debug`

Useful checks:

```bash
curl http://127.0.0.1:9222/sessions
curl http://127.0.0.1:9222/docs
```

`/sessions` shows the currently attached browser sessions. `/docs` exposes the Browserless HTTP surface when you need to verify that the debug browser is alive before attaching.
