import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { test } from 'bun:test'
import ts from 'typescript'

const scannedDirectories = ['src', 'e2e', 'scripts']
const scannedExtensions = new Set(['.ts', '.tsx'])

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const filePath = join(directory, entry)
    const stats = statSync(filePath)

    if (stats.isDirectory()) {
      return collectSourceFiles(filePath)
    }

    return scannedExtensions.has(extname(filePath)) ? [filePath] : []
  })
}

function findEmptyCatchBlocks(sourceText: string, filePath: string) {
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const violations: string[] = []

  function visit(node: ts.Node) {
    if (ts.isCatchClause(node) && node.block.statements.length === 0) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      violations.push(`${filePath}:${position.line + 1}:${position.character + 1}`)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violations
}

test('src/contracts/errors/no-empty-catch.spec.ts', () => {
  const fixtureViolations = findEmptyCatchBlocks('try { throw new Error() } catch (_error) {}', 'fixture.ts')
  if (fixtureViolations.length !== 1) {
    throw new Error('Empty catch fixture should fail the static guard.')
  }

  const violations = scannedDirectories.flatMap((directory) =>
    collectSourceFiles(join(process.cwd(), directory)).flatMap((filePath) =>
      findEmptyCatchBlocks(readFileSync(filePath, 'utf8'), relative(process.cwd(), filePath)),
    ),
  )

  if (violations.length > 0) {
    throw new Error(
      `Caught errors must be handled, reported, converted, or rethrown; empty catch blocks are prohibited.\n${violations.join('\n')}`,
    )
  }
})
