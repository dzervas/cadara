type Cleanup = void | (() => void)

interface EffectSlot {
  cleanup: Cleanup
  deps: readonly unknown[] | undefined
}

interface MemoSlot {
  deps: readonly unknown[] | undefined
  value: unknown
}

function areHookDepsEqual(
  previous: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
) {
  if (previous === undefined || next === undefined) {
    return false
  }

  return previous.length === next.length && previous.every((value, index) => Object.is(value, next[index]))
}

export function createHookTestHarness() {
  let hookIndex = 0
  let stateSlots: unknown[] = []
  let refSlots: Array<{ current: unknown }> = []
  let memoSlots: MemoSlot[] = []
  let effectSlots: EffectSlot[] = []
  let pendingEffects: Array<() => void> = []

  const reactModule = {
    useCallback<T>(callback: T, deps: readonly unknown[] | undefined) {
      return reactModule.useMemo(() => callback, deps)
    },
    useEffect(effect: () => Cleanup, deps?: readonly unknown[]) {
      const slotIndex = hookIndex++
      const previous = effectSlots[slotIndex]
      if (previous && areHookDepsEqual(previous.deps, deps)) {
        return
      }

      pendingEffects.push(() => {
        if (previous?.cleanup instanceof Function) {
          previous.cleanup()
        }

        effectSlots[slotIndex] = {
          cleanup: effect(),
          deps,
        }
      })
    },
    useMemo<T>(factory: () => T, deps: readonly unknown[] | undefined) {
      const slotIndex = hookIndex++
      const previous = memoSlots[slotIndex]
      if (previous && areHookDepsEqual(previous.deps, deps)) {
        return previous.value as T
      }

      const value = factory()
      memoSlots[slotIndex] = { deps, value }
      return value
    },
    useRef<T>(initialValue: T) {
      const slotIndex = hookIndex++
      const existing = refSlots[slotIndex] as { current: T } | undefined
      if (existing) {
        return existing
      }

      const ref = { current: initialValue }
      refSlots[slotIndex] = ref
      return ref
    },
    useState<T>(initialValue: T | (() => T)) {
      const slotIndex = hookIndex++
      if (slotIndex >= stateSlots.length) {
        stateSlots[slotIndex] =
          initialValue instanceof Function ? initialValue() : initialValue
      }

      const setState = (value: T | ((current: T) => T)) => {
        const current = stateSlots[slotIndex] as T
        stateSlots[slotIndex] = value instanceof Function ? value(current) : value
      }

      return [stateSlots[slotIndex] as T, setState] as const
    },
  }

  return {
    cleanup() {
      for (const slot of effectSlots) {
        if (slot?.cleanup instanceof Function) {
          slot.cleanup()
        }
      }
    },
    async flushEffects() {
      const queued = [...pendingEffects]
      pendingEffects = []
      for (const effect of queued) {
        effect()
      }
      await flushMicrotasks()
    },
    reactModule,
    render<T>(renderHook: () => T) {
      hookIndex = 0
      pendingEffects = []
      return renderHook()
    },
    reset() {
      this.cleanup()
      hookIndex = 0
      stateSlots = []
      refSlots = []
      memoSlots = []
      effectSlots = []
      pendingEffects = []
    },
  }
}

export async function flushMicrotasks(count = 4) {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve()
  }
}
