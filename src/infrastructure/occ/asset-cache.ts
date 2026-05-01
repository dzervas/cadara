const OPENCASCADE_PACKAGE_VERSION = '2.0.0-beta.b5ff984'

export const OCC_ASSET_CACHE_NAME = `cadara-occ-assets-opencascade-${OPENCASCADE_PACKAGE_VERSION}`
export const OCC_SERVICE_WORKER_PATH = '/occ-asset-cache-sw.js'

interface ServiceWorkerVersionDocumentLike {
  querySelector(selector: string): null | {
    getAttribute(name: string): string | null
  }
}

export function isOpenCascadeAssetUrl(value: string) {
  let pathname: string

  try {
    pathname = new URL(value, 'https://cadara.local').pathname
  } catch {
    pathname = value
  }

  return /cadara-occ\.(?:js|wasm)$/.test(pathname)
}

export function getOpenCascadeAssetHeaders(pathname: string) {
  if (!isOpenCascadeAssetUrl(pathname)) {
    return {}
  }

  return {
    ...(pathname.endsWith('.wasm') ? { 'Content-Type': 'application/wasm' } : {}),
    'Cache-Control': 'public, max-age=31536000, immutable',
  }
}

export function getOpenCascadeServiceWorkerRegistrationOptions() {
  return {
    scope: '/',
  }
}

export function getOpenCascadeServiceWorkerVersion(
  documentLike: ServiceWorkerVersionDocumentLike | null =
    typeof document === 'undefined' ? null : document,
) {
  const moduleScriptSrc = documentLike
    ?.querySelector('script[type="module"][src]')
    ?.getAttribute('src')
    ?.trim()

  return moduleScriptSrc && moduleScriptSrc.length > 0
    ? moduleScriptSrc
    : null
}

export function getOpenCascadeServiceWorkerUrl(
  documentLike: ServiceWorkerVersionDocumentLike | null =
    typeof document === 'undefined' ? null : document,
) {
  const version = getOpenCascadeServiceWorkerVersion(documentLike)

  return version
    ? `${OCC_SERVICE_WORKER_PATH}?v=${encodeURIComponent(version)}`
    : OCC_SERVICE_WORKER_PATH
}

export async function registerOpenCascadeAssetCache(
  navigatorLike: Pick<Navigator, 'serviceWorker'> | null =
    typeof navigator === 'undefined' ? null : navigator,
  documentLike: ServiceWorkerVersionDocumentLike | null =
    typeof document === 'undefined' ? null : document,
) {
  if (!navigatorLike || !('serviceWorker' in navigatorLike)) {
    return null
  }

  return navigatorLike.serviceWorker.register(
    getOpenCascadeServiceWorkerUrl(documentLike),
    getOpenCascadeServiceWorkerRegistrationOptions(),
  )
}
