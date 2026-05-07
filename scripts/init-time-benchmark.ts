import { chromium, type Page } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'

import { createTwoExtrudeBodiesOperationHistory } from '../e2e/helpers/modeling-fixtures.ts'
import { MODELING_OPERATION_HISTORY_STORAGE_KEY } from '../src/domain/modeling/modeling-history-persistence.ts'

const PREVIEW_HOST = '127.0.0.1'
const PREVIEW_PORT = 4173
const PREVIEW_URL_BASE = `http://${PREVIEW_HOST}:${PREVIEW_PORT}/`
const DOCUMENT_REPOSITORY_URL_STORAGE_KEY = 'cad.documentRepository.automergeUrls.v1'
const SERVER_TIMEOUT_MS = 120_000
const LOAD_TIMEOUT_MS = 120_000
const CUSTOM_OCC_ASSET_BASENAMES = ['cadara-occ.js', 'cadara-occ.wasm'] as const

function buildPreviewUrl(runId: string) {
  return `${PREVIEW_URL_BASE}?cadPerfMode=1&cadDisableRepository=1&cadRepositoryDbName=${encodeURIComponent(`load-time-${runId}`)}`
}

function sha256File(path: string) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function assertPreviewAssetsAreFresh() {
  for (const basename of CUSTOM_OCC_ASSET_BASENAMES) {
    const publicPath = `/app/public/${basename}`
    const distPath = `/app/dist/${basename}`
    const publicExists = existsSync(publicPath)
    const distExists = existsSync(distPath)

    if (!publicExists && !distExists) {
      continue
    }

    if (publicExists !== distExists) {
      throw new Error(
        `Custom OpenCascade asset set is incomplete for preview: expected both ${publicPath} and ${distPath}. Run \`bun run build\` after rebuilding the custom kernel.`,
      )
    }

    if (sha256File(publicPath) !== sha256File(distPath)) {
      throw new Error(
        `Preview asset is stale for ${basename}: ${publicPath} and ${distPath} differ. Run \`bun run build\` after rebuilding the custom kernel.`,
      )
    }
  }
}

function startPreviewServer() {
  const server = spawn(
    'bunx',
    ['vite', 'preview', '--host', PREVIEW_HOST, '--port', String(PREVIEW_PORT)],
    {
      cwd: '/app',
      stdio: 'pipe',
    },
  )

  server.stdout.on('data', (chunk) => process.stdout.write(`[preview] ${chunk}`))
  server.stderr.on('data', (chunk) => process.stderr.write(`[preview] ${chunk}`))

  return server
}

async function waitForServer(url: string, timeoutMs: number) {
  const startedAt = performance.now()
  let lastError: unknown = null

  while (performance.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)

      if (response.ok) {
        return
      }
    } catch (error: unknown) {
      lastError = error
    }

    await delay(250)
  }

  throw new Error(`Timed out waiting for preview server at ${url}.`, { cause: lastError })
}

async function stopServer(server: ChildProcessWithoutNullStreams) {
  if (server.exitCode !== null) {
    return
  }

  server.kill('SIGTERM')

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      if (server.exitCode === null) {
        server.kill('SIGKILL')
      }
      resolve()
    }, 5_000)

    server.once('exit', () => {
      clearTimeout(timeout)
      resolve()
    })
  })
}

async function waitForRestoredGeometry(page: Page) {
  console.log('Waiting for first OCC-backed snapshot...')
  const restoreState = await page.waitForFunction(
    () => {
      const text = document.body?.innerText ?? ''
      const occPerf = (window as Window & {
        __cadOccPerf?: {
          firstSnapshotReadyAt?: number | null
          warmupStatus?: 'idle' | 'pending' | 'fulfilled' | 'rejected'
          warmupError?: string | null
        }
      }).__cadOccPerf

      if (text.includes('History restore failed')) {
        return 'restoreFailed'
      }

      if (occPerf?.warmupStatus === 'rejected') {
        return `warmupFailed:${occPerf.warmupError ?? 'unknown'}`
      }

      return occPerf?.firstSnapshotReadyAt != null ? 'ready' : null
    },
    undefined,
    { timeout: LOAD_TIMEOUT_MS },
  )

  const state = await restoreState.jsonValue()

  if (state !== 'ready') {
    const bodyText = (await page.locator('body').textContent()) ?? ''
    console.error('Preview build failed OCC readiness probe. Body text snapshot:')
    console.error(bodyText.slice(0, 4000))
    throw new Error(`Preview build did not reach OCC-ready state: ${String(state)}`)
  }

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
  console.log('First OCC-backed snapshot signal reached.')
}

async function main() {
  if (!existsSync('/app/dist/index.html')) {
    throw new Error('Preview build is missing. Run `bun run build` once a valid build baseline is available.')
  }
  assertPreviewAssetsAreFresh()

  const runId = `${Date.now()}`
  const previewUrl = buildPreviewUrl(runId)
  const payload = createTwoExtrudeBodiesOperationHistory()
  const serializedPayload = JSON.stringify(payload)
  const server = startPreviewServer()

  try {
    await waitForServer(previewUrl, SERVER_TIMEOUT_MS)

    const browser = await chromium.launch({ headless: true })

    try {
      const page = await browser.newPage()
      page.on('pageerror', (error) => {
        console.error(`[pageerror] ${error.message}`)
      })
      page.on('console', (message) => {
        if (message.type() === 'error') {
          console.error(`[console:${message.type()}] ${message.text()}`)
        }
      })

      await page.addInitScript(
        ({ storageKey, repositoryUrlStorageKey, serialized }) => {
          localStorage.setItem(storageKey, serialized)
          localStorage.removeItem(repositoryUrlStorageKey)
          ;(
            window as Window & {
              __cadLoadTime?: { startedAt: number }
            }
          ).__cadLoadTime = { startedAt: performance.now() }
        },
        {
          repositoryUrlStorageKey: DOCUMENT_REPOSITORY_URL_STORAGE_KEY,
          storageKey: MODELING_OPERATION_HISTORY_STORAGE_KEY,
          serialized: serializedPayload,
        },
      )

      const navigationStartedAt = performance.now()
      await page.goto(previewUrl, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS })
      const domContentLoadedMs = performance.now() - navigationStartedAt

      await waitForRestoredGeometry(page)

      const totalWallClockMs = performance.now() - navigationStartedAt
      const occPerf = await page.evaluate(() => window.__cadOccPerf ?? null)
      const mutationPerf = await page.evaluate(async () => window.__cadMeasureOccMutation?.() ?? null)
      const browserElapsedMs = await page.evaluate(() => {
        const state = (
          window as Window & {
            __cadLoadTime?: { startedAt: number }
          }
        ).__cadLoadTime

        return state ? performance.now() - state.startedAt : null
      })
      const bodyText = (await page.locator('body').innerText()) ?? ''

      console.log(
        JSON.stringify(
          {
            url: previewUrl,
            fixture: 'two-extrude-bodies',
            historyEntryCount: payload.entries.length,
            revisionId: null,
            domContentLoadedMs: Number(domContentLoadedMs.toFixed(1)),
            restoredGeometryMs: Number(totalWallClockMs.toFixed(1)),
            browserElapsedMs: browserElapsedMs === null ? null : Number(browserElapsedMs.toFixed(1)),
            occWarmupMs:
              occPerf?.warmupStartedAt != null && occPerf?.warmupSettledAt != null
                ? Number((occPerf.warmupSettledAt - occPerf.warmupStartedAt).toFixed(1))
                : null,
            occWarmupStatus: occPerf?.warmupStatus ?? null,
            firstSnapshotReadyMs:
              occPerf?.firstSnapshotReadyAt != null
                ? Number(occPerf.firstSnapshotReadyAt.toFixed(1))
                : null,
            firstNonEmptyGeometryFrameMs:
              occPerf?.firstNonEmptyGeometryFrameAt != null
                ? Number(occPerf.firstNonEmptyGeometryFrameAt.toFixed(1))
                : null,
            postStartupMutationLatencyMs:
              mutationPerf?.elapsedMs != null
                ? Number(mutationPerf.elapsedMs.toFixed(1))
                : null,
            postStartupMutationAccepted: mutationPerf?.accepted ?? null,
            bodyTextSample: bodyText.slice(0, 500),
            readinessSignal: 'window.__cadOccPerf.firstNonEmptyGeometryFrameAt || firstSnapshotReadyAt + 2 animation frames',
          },
          null,
          2,
        ),
      )
    } finally {
      await browser.close()
    }
  } finally {
    await stopServer(server)
  }
}

await main()
