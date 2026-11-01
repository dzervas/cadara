import { StrictMode } from "react";
import { MantineProvider } from "@mantine/core";
import { createRoot } from "react-dom/client";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@mantine/core/styles.css";
import "./index.css";
import App from "./App.tsx";
import { SignInComplete } from "@/components/layout/sign-in-complete";
import { getWorkbenchSessionPort } from "@/workbench/shell/workbench-session";
import {
  createSentryPerformanceTelemetry,
  shouldEnablePerformanceTelemetry,
} from "@/contracts/errors/sentry-client";
import { startBrowserOccWarmup } from "@/infrastructure/occ/browser-kernel-runtime";
import {
  workbenchCssVariablesResolver,
  workbenchTheme,
} from "@/theme/workbench-theme";

const signInComplete = new URLSearchParams(window.location.search).has(
  "accountSignedIn",
);

if (!signInComplete)
  startBrowserOccWarmup(
    createSentryPerformanceTelemetry({
      enabled: shouldEnablePerformanceTelemetry({
        isProduction: import.meta.env.PROD,
        search: typeof window === "undefined" ? null : window.location.search,
      }),
    }),
  );

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MantineProvider
      theme={workbenchTheme}
      defaultColorScheme="dark"
      cssVariablesResolver={workbenchCssVariablesResolver}
    >
      {signInComplete ? (
        <SignInComplete session={getWorkbenchSessionPort()} />
      ) : (
        <App />
      )}
    </MantineProvider>
  </StrictMode>,
);
