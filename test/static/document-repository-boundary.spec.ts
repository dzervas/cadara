import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
test('test/static/document-repository-boundary.spec.ts', () => {  const sourceRoot = join(process.cwd(), 'src')
  const offenders: string[] = []

  for (const file of walkTypescriptFiles(sourceRoot)) {
    const relativePath = relative(process.cwd(), file)
    const source = readFileSync(file, 'utf8')
    if (
      source.includes('@automerge/automerge')
      && !relativePath.includes('src/infrastructure/persistence/indexeddb-automerge-document-repository.ts')
      && !relativePath.includes('src/infrastructure/persistence/document-repository-url-store.ts')
    ) {
      offenders.push(relativePath)
    }
  }

  expectTrue(
    offenders.length === 0,
    `Automerge imports must stay inside the repository implementation layer: ${offenders.join(', ')}`,
  )
})

function walkTypescriptFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      return walkTypescriptFiles(path)
    }
    return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : []
  })
}
