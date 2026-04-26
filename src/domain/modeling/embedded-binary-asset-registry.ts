const embeddedBinaryAssets = new Map<string, { bytes: Uint8Array, mediaType: string, objectUrl: string | null }>()

export function registerEmbeddedBinaryAsset(input: {
  assetId: string
  bytes: Uint8Array
  mediaType: string
}) {
  const existing = embeddedBinaryAssets.get(input.assetId)
  if (existing?.objectUrl) {
    URL.revokeObjectURL(existing.objectUrl)
  }

  const objectUrlBytes = new Uint8Array(input.bytes.byteLength)
  objectUrlBytes.set(input.bytes)

  embeddedBinaryAssets.set(input.assetId, {
    bytes: input.bytes.slice(),
    mediaType: input.mediaType,
    objectUrl: typeof URL.createObjectURL === 'function'
      ? URL.createObjectURL(new Blob([objectUrlBytes], { type: input.mediaType }))
      : null,
  })
}

export function getEmbeddedBinaryAssetObjectUrl(assetId: string) {
  return embeddedBinaryAssets.get(assetId)?.objectUrl ?? null
}

export function clearEmbeddedBinaryAssetRegistry() {
  for (const asset of embeddedBinaryAssets.values()) {
    if (asset.objectUrl) {
      URL.revokeObjectURL(asset.objectUrl)
    }
  }

  embeddedBinaryAssets.clear()
}
