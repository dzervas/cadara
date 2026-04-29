import { registerExportProvider } from '@/domain/export/provider-registry'
import { stlExportProvider } from '@/domain/export/providers/stl-export-provider'
import { stepExportProvider } from '@/domain/export/providers/step-export-provider'
import { threeMfExportProvider } from '@/domain/export/providers/threemf-export-provider'

export function registerBuiltinExportProviders() {
  registerExportProvider(stlExportProvider)
  registerExportProvider(stepExportProvider)
  registerExportProvider(threeMfExportProvider)
}
