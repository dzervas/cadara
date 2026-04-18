import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import type { Plugin } from 'vite'

const buildMetadataModuleId = 'virtual:cadara-build-metadata'
const resolvedBuildMetadataModuleId = `\0${buildMetadataModuleId}`

interface PackageMetadata {
  version?: unknown
}

function readPackageVersion(rootDir: string) {
  const packageJson = JSON.parse(
    readFileSync(path.join(rootDir, 'package.json'), 'utf8'),
  ) as PackageMetadata

  return typeof packageJson.version === 'string' ? packageJson.version : '0.0.0'
}

function readGitCommit(rootDir: string) {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'unknown'
  }
}

export function createBuildMetadataPlugin(rootDir: string): Plugin {
  return {
    name: 'cadara-build-metadata',
    resolveId(id) {
      return id === buildMetadataModuleId ? resolvedBuildMetadataModuleId : null
    },
    load(id) {
      if (id !== resolvedBuildMetadataModuleId) {
        return null
      }

      return [
        `export const appVersion = ${JSON.stringify(readPackageVersion(rootDir))};`,
        `export const gitCommit = ${JSON.stringify(readGitCommit(rootDir))};`,
      ].join('\n')
    },
  }
}
