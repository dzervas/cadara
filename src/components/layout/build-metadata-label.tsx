import { appVersion, gitCommit } from 'virtual:cadara-build-metadata'

import { formatBuildMetadata, getBuildModeLabel } from '@/components/layout/build-metadata'

export function BuildMetadataLabel() {
  const label = formatBuildMetadata({
    version: appVersion,
    commit: gitCommit,
    mode: getBuildModeLabel(import.meta.env.MODE, import.meta.env.DEV),
  })

  return (
    <div className="pointer-events-none fixed bottom-10 left-2 z-50 select-none text-[10px] leading-none text-[var(--cad-muted)] opacity-65">
      {label}
    </div>
  )
}
