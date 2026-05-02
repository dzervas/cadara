import { StrictMode } from "react";
import { MantineProvider } from "@mantine/core";
import { createRoot } from "react-dom/client";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@mantine/core/styles.css";
import "./index.css";
import App from "./App.tsx";
import { startBrowserOccWarmup } from "@/infrastructure/occ/browser-kernel-runtime";
import { workbenchCssVariablesResolver, workbenchTheme } from "@/theme/workbench-theme";

startBrowserOccWarmup();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<MantineProvider
			theme={workbenchTheme}
			defaultColorScheme="dark"
			cssVariablesResolver={workbenchCssVariablesResolver}
		>
			<App />
		</MantineProvider>
	</StrictMode>,
);
