import { useEffect, useMemo, useRef } from "react";

import { WorkbenchApp } from "@/app/workbench/workbench-app";
import { createBrowserDocumentSyncWorkerClient } from "@/infrastructure/workers/document-sync-worker-browser-client";
import { registerOpenCascadeAssetCache } from "@/infrastructure/occ/asset-cache";
import {
	createBrowserOccKernelAdapter,
	startBrowserOccWarmup,
} from "@/infrastructure/occ/browser-kernel-runtime";
import { ErrorReporterProvider } from "@/hooks/error-reporter-provider";
import { createToolActionBus } from "@/core/tools/tool-action-bus";
import { ReportedErrorBoundary } from "@/components/layout/reported-error-boundary";
import { BuildMetadataLabel } from "@/components/layout/build-metadata-label";
import { SentryAdBlockNotification } from "@/components/layout/sentry-ad-block-notification";
import { normalizeUnknownError } from "@/contracts/errors";
import {
	createSentryPerformanceTelemetry,
	shouldEnablePerformanceTelemetry,
} from "@/contracts/errors/sentry-client";
import { useErrorReporter } from "@/hooks/use-error-reporter";
import { createBuiltinRuntimeExtensionRegistryComposition } from "@/domain/extensions/runtime-registry-composition";

function App() {
	const actionBus = useMemo(() => createToolActionBus(), []);
	const runtimeExtensionRegistries = useMemo(
		() => createBuiltinRuntimeExtensionRegistryComposition(),
		[],
	);
	const performanceTelemetry = useMemo(
		() =>
			createSentryPerformanceTelemetry({
				enabled: shouldEnablePerformanceTelemetry({
					isProduction: import.meta.env.PROD,
					search: typeof window === "undefined" ? null : window.location.search,
				}),
			}),
		[],
	);
	const documentSyncWorkerClient = useMemo(
		() =>
			typeof window === "undefined"
				? null
				: createBrowserDocumentSyncWorkerClient({ search: window.location.search }),
		[],
	);
	const documentSyncWorkerDisposeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	useEffect(() => {
		if (documentSyncWorkerDisposeTimerRef.current) {
			clearTimeout(documentSyncWorkerDisposeTimerRef.current);
			documentSyncWorkerDisposeTimerRef.current = null;
		}

		return () => {
			if (!documentSyncWorkerClient) {
				return;
			}

			documentSyncWorkerDisposeTimerRef.current = setTimeout(() => {
				documentSyncWorkerClient.dispose();
				documentSyncWorkerDisposeTimerRef.current = null;
			}, 0);
		};
	}, [documentSyncWorkerClient]);

	return (
		<ErrorReporterProvider>
			<ReportedErrorBoundary>
				<OccWarmupErrorEffect performanceTelemetry={performanceTelemetry} />
				<OccAssetCacheEffect />
				<WorkbenchApp
					actionBus={actionBus}
					createKernelAdapter={createBrowserOccKernelAdapter}
					documentSyncWorkerClient={shouldDisableDevRepository() ? null : documentSyncWorkerClient}
					performanceTelemetry={performanceTelemetry}
					runtimeExtensionRegistries={runtimeExtensionRegistries}
				/>
			</ReportedErrorBoundary>
			<SentryAdBlockNotification />
			<BuildMetadataLabel />
		</ErrorReporterProvider>
	);
}

function OccAssetCacheEffect() {
	const errorReporter = useErrorReporter();

	useEffect(() => {
		if (typeof window === "undefined" || !import.meta.env.PROD) {
			return;
		}

		void registerOpenCascadeAssetCache().catch((error: unknown) => {
			errorReporter.report(
				normalizeUnknownError(error, {
					code: "app/operation-failed",
					fallbackMessage: "OpenCascade asset cache registration failed.",
					context: [{ key: "operation", value: "occ.assetCache.register" }],
				}),
				{
					source: "occ-asset-cache",
					visibility: "developer",
					dedupeKey: "occ-asset-cache:register",
				},
			);
		});
	}, [errorReporter]);

	return null;
}

function OccWarmupErrorEffect({ performanceTelemetry }: { performanceTelemetry: Parameters<typeof startBrowserOccWarmup>[0] }) {
	const errorReporter = useErrorReporter();

	useEffect(() => {
		const warmupPromise = startBrowserOccWarmup(performanceTelemetry);
		if (!warmupPromise) return;

		void warmupPromise.catch((error: unknown) => {
			errorReporter.report(
				normalizeUnknownError(error, {
					code: "editor/effect-failed",
					fallbackMessage: "OpenCascade initialization failed.",
					context: [{ key: "operation", value: "occ.preload" }],
				}),
				{
					source: "occ-preload",
					visibility: "user",
					dedupeKey: "occ-preload:init",
				},
			);
		});
	}, [errorReporter, performanceTelemetry]);

	return null;
}

function shouldDisableDevRepository() {
	if (typeof window === "undefined") {
		return false;
	}

	return new URLSearchParams(window.location.search).get("cadDisableRepository") === "1";
}

export default App;
