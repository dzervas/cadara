import { StrictMode } from 'react'
import { MantineProvider } from '@mantine/core'
import { createRoot } from 'react-dom/client'
import '@mantine/core/styles.css'
import './index.css'
import App from './App.tsx'
import { startBrowserOccWarmup } from '@/domain/modeling/occ/browser-kernel-runtime'
import { workbenchCssVariablesResolver, workbenchTheme } from '@/theme/workbench-theme'

startBrowserOccWarmup()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider
      theme={workbenchTheme}
      defaultColorScheme="dark"
      cssVariablesResolver={workbenchCssVariablesResolver}
    >
      <App />
    </MantineProvider>
  </StrictMode>,
)
