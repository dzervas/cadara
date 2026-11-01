import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import {
  workbenchCssVariablesResolver,
  workbenchTheme,
} from "@/theme/workbench-theme";
import { ErrorReporterProvider } from "@/hooks/error-reporter-provider";
import { ReportedErrorBoundary } from "@/components/layout/reported-error-boundary";
import { DashboardApp } from "./dashboard-app";

createRoot(document.getElementById("root")!).render(
  <MantineProvider
    theme={workbenchTheme}
    defaultColorScheme="dark"
    cssVariablesResolver={workbenchCssVariablesResolver}
  >
    <ErrorReporterProvider>
      <ReportedErrorBoundary>
        <DashboardApp />
      </ReportedErrorBoundary>
    </ErrorReporterProvider>
  </MantineProvider>,
);
