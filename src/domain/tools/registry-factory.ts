export interface DomainRegistry<TId extends string, TDefinition> {
  get(id: TId): TDefinition
  getAll(): readonly TDefinition[]
  has(id: string): id is TId
  find?(id: TId): TDefinition | null
}

export function createRegistry<TId extends string, TDefinition>(
  definitions: readonly TDefinition[],
  getKey: (definition: TDefinition) => TId,
  label: string,
): DomainRegistry<TId, TDefinition> {
  const definitionsById = new Map<TId, TDefinition>(
    definitions.map((definition) => [getKey(definition), definition]),
  )

  return {
    get(id) {
      const definition = definitionsById.get(id)

      if (!definition) {
        throw new Error(`${label} ${id} is not registered.`)
      }

      return definition
    },
    getAll() {
      return definitions
    },
    has(id): id is TId {
      return definitionsById.has(id as TId)
    },
    find(id) {
      return definitionsById.get(id) ?? null
    },
  }
}

