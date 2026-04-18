import { chromium, type Page } from '@playwright/test'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { setTimeout as delay } from 'node:timers/promises'

import { createTwoExtrudeBodiesOperationHistory } from '../e2e/helpers/modeling-fixtures.ts'
import { MODELING_OPERATION_HISTORY_STORAGE_KEY } from '../src/domain/modeling/modeling-history-persistence.ts'

const PREVIEW_HOST = '127.0.0.1'
const PREVIEW_PORT = 4173
const PREVIEW_URL = `http://${PREVIEW_HOST}:${PREVIEW_PORT}`
const SERVER_TIMEOUT_MS = 120_000
const LOAD_TIMEOUT_MS = 120_000

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
  console.log('Waiting for workbench shell...')
  await page.getByText('Machine:').waitFor({ state: 'visible', timeout: LOAD_TIMEOUT_MS })
  console.log('Waiting for successful history restore...')
  const restoreState = await page.waitForFunction(
    () => {
      const text = document.body?.innerText ?? ''

      if (text.includes('History restore failed')) {
        return 'restoreFailed'
      }

      return /Revision:\s+(?!loading)\S+/.test(text) ? 'ready' : null
    },
    undefined,
    { timeout: LOAD_TIMEOUT_MS },
  )

  if ((await restoreState.jsonValue()) !== 'ready') {
    const bodyText = (await page.locator('body').textContent()) ?? ''
    console.error('Preview build failed persisted-history restore. Body text snapshot:')
    console.error(bodyText.slice(0, 4000))
    throw new Error('Preview build reported "History restore failed" before geometry became ready.')
  }

  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
  console.log('Restored geometry signal reached.')
}

async function main() {
  if (!existsSync('/app/dist/index.html')) {
    throw new Error('Preview build is missing. Run `bun run build` once a valid build baseline is available.')
  }

  const payload = createTwoExtrudeBodiesOperationHistory()
  const serializedPayload = JSON.stringify(payload)
  const server = startPreviewServer()

  try {
    await waitForServer(PREVIEW_URL, SERVER_TIMEOUT_MS)

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
        ({ storageKey, serialized }) => {
          localStorage.setItem(storageKey, serialized)
          ;(
            window as Window & {
              __cadLoadTime?: { startedAt: number }
            }
          ).__cadLoadTime = { startedAt: performance.now() }
        },
        {
          storageKey: MODELING_OPERATION_HISTORY_STORAGE_KEY,
          serialized: serializedPayload,
        },
      )

      const navigationStartedAt = performance.now()
      await page.goto(PREVIEW_URL, { waitUntil: 'domcontentloaded', timeout: LOAD_TIMEOUT_MS })
      const domContentLoadedMs = performance.now() - navigationStartedAt

      await waitForRestoredGeometry(page)

      const totalWallClockMs = performance.now() - navigationStartedAt
      const browserElapsedMs = await page.evaluate(() => {
        const state = (
          window as Window & {
            __cadLoadTime?: { startedAt: number }
          }
        ).__cadLoadTime

        return state ? performance.now() - state.startedAt : null
      })
      const bodyText = (await page.locator('body').textContent()) ?? ''
      const revisionMatch = bodyText.match(/Revision:\s*(\S+)/)

      console.log(
        JSON.stringify(
          {
            url: PREVIEW_URL,
            fixture: 'two-extrude-bodies',
            historyEntryCount: payload.entries.length,
            revisionId: revisionMatch?.[1] ?? null,
            domContentLoadedMs: Number(domContentLoadedMs.toFixed(1)),
            restoredGeometryMs: Number(totalWallClockMs.toFixed(1)),
            browserElapsedMs: browserElapsedMs === null ? null : Number(browserElapsedMs.toFixed(1)),
            readinessSignal: 'debugger shell + non-loading revision + 2 animation frames',
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
