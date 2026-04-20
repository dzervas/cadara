export function deleteOccObject(object: { delete?: () => void } | null | undefined) {
  object?.delete?.()
}

