import type { ToolIconId } from '@/domain/tools/schema'
import { toolbarToolIconAssetMap } from '@/components/layout/toolbar-tool-icon-assets'

export function getToolbarToolIconSrc(icon: ToolIconId) {
  const fileName = toolbarToolIconAssetMap[icon]
  const globalAssets = globalThis as typeof globalThis & {
    __CADARA_SINGLE_ASSETS__?: Window['__CADARA_SINGLE_ASSETS__']
  }

  return globalAssets.__CADARA_SINGLE_ASSETS__?.icons?.[fileName] ?? `/icons/${fileName}`
}
