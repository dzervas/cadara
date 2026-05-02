import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
const ROOT = process.cwd()

function walk(directory: string): string[] {
  try {
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
  } catch {
    return []
  }
}

function getLayerFiles(layerRoot: string) {
  return walk(join(ROOT, layerRoot)).filter((filePath) =>
    /\.(ts|tsx)$/.test(filePath) && !/\.spec\.(ts|tsx)$/.test(filePath),
  )
}

test('src/layer-architecture-boundary.spec.ts core stays framework and browser free', () => {  const offenders: string[] = []
  const browserDocumentPattern = /\bdocument\.(createElement|documentElement|querySelector|getElementById|body|head)\b/

  for (const filePath of getLayerFiles('src/core')) {
    const source = readFileSync(filePath, 'utf8')
    if (
      source.includes("from 'react'")
      || source.includes('from "react"')
      || source.includes('@mantine/')
      || source.includes("from 'three'")
      || source.includes('from "three"')
      || source.includes('@react-three/')
      || /\bwindow\./.test(source)
      || browserDocumentPattern.test(source)
      || source.includes('localStorage')
      || source.includes('indexedDB')
      || source.includes('BroadcastChannel')
      || /\bnew Worker\(/.test(source)
      || source.includes("from '@/app/")
      || source.includes('from "@/app/')
      || source.includes("from '@/hooks/")
      || source.includes('from "@/hooks/')
      || source.includes("from '@/components/")
      || source.includes('from "@/components/')
      || source.includes("from '@/application/")
      || source.includes('from "@/application/')
      || source.includes("from '@/infrastructure/")
      || source.includes('from "@/infrastructure/')
    ) {
      offenders.push(relative(ROOT, filePath))
    }
  }

  expectTrue(
    offenders.length === 0,
    `Core modules must remain framework-, browser-, and adapter-free.\n${offenders.join('\n')}`,
  )
})

test('src/layer-architecture-boundary.spec.ts application stays React free', () => {  const offenders: string[] = []

  for (const filePath of getLayerFiles('src/application')) {
    const source = readFileSync(filePath, 'utf8')
    if (
      source.includes("from 'react'")
      || source.includes('from "react"')
      || source.includes("from '@/hooks/")
      || source.includes('from "@/hooks/')
      || source.includes("from '@/components/")
      || source.includes('from "@/components/')
    ) {
      offenders.push(relative(ROOT, filePath))
    }
  }

  expectTrue(
    offenders.length === 0,
    `Application modules must not depend on React hooks or UI components.\n${offenders.join('\n')}`,
  )
})

test('src/layer-architecture-boundary.spec.ts infrastructure stays outside UI composition', () => {  const offenders: string[] = []

  for (const filePath of getLayerFiles('src/infrastructure')) {
    const source = readFileSync(filePath, 'utf8')
    if (
      source.includes("from '@/app/")
      || source.includes('from "@/app/')
      || source.includes("from '@/hooks/")
      || source.includes('from "@/hooks/')
      || source.includes("from '@/components/")
      || source.includes('from "@/components/')
    ) {
      offenders.push(relative(ROOT, filePath))
    }
  }

  expectTrue(
    offenders.length === 0,
    `Infrastructure modules must not depend on UI composition layers.\n${offenders.join('\n')}`,
  )
})
