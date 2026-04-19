import ocFullJS from 'opencascade.js/dist/opencascade.full.js'

import {
  createOpenCascadeInitializerFromMainJS,
  type OpenCascadeInitializationOptions,
} from '@/domain/modeling/occ/runtime'

const defaultInitializer = createOpenCascadeInitializerFromMainJS(
  ocFullJS as unknown as NonNullable<OpenCascadeInitializationOptions['mainJS']>,
)

export default defaultInitializer
