import { createContext } from 'react'

import type { RuntimeExtensionRegistryComposition } from '@/domain/extensions/runtime-registry-composition'

export const RuntimeExtensionRegistryContext = createContext<RuntimeExtensionRegistryComposition | null>(null)
