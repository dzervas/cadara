import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
const ROOT = process.cwd()
const CONTRACTS_ROOT = join(ROOT, 'src/contracts')

test('src/contracts/contracts-domain-boundary.spec.ts', () => {  const offenders: string[] = []

  for (const filePath of walk(CONTRACTS_ROOT)) {
    if (!/\.(ts|tsx)$/.test(filePath) || /\.spec\.(ts|tsx)$/.test(filePath)) {
      continue
    }

    const source = readFileSync(filePath, 'utf8')
    if (
      source.includes("from '@/domain/'")
      || source.includes('from "@/domain/')
      || source.includes("from '@/core/'")
      || source.includes('from "@/core/')
      || source.includes("from '@/application/'")
      || source.includes('from "@/application/')
      || source.includes("from '@/infrastructure/'")
      || source.includes('from "@/infrastructure/')
    ) {
      offenders.push(relative(ROOT, filePath))
    }
  }

  expectTrue(
    offenders.length === 0,
    `Contracts modules must not import implementation-layer modules.\n${offenders.join('\n')}`,
  )
})

function walk(directory: string): string[] {
  const entries = readdirSync(directory)
  const files: string[] = []

  for (const entry of entries) {
    const entryPath = join(directory, entry)
    const entryStat = statSync(entryPath)

    if (entryStat.isDirectory()) {
      files.push(...walk(entryPath))
      continue
    }

    files.push(entryPath)
  }

  return files
}
