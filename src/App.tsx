import { useEffect, useMemo, useRef } from "react";

import { CadWorkbench } from "@/app/workbench/cad-workbench";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { createLocalStorageOperationHistoryStore } from "@/domain/modeling/modeling-history-persistence";
import { createLocalStorageDocumentRepositoryUrlStore } from "@/domain/modeling/automerge-indexeddb-document-repository";
import { createBrowserDocumentSyncWorkerClient } from "@/domain/modeling/document-sync-worker-client";
import { createWorkerBackedDocumentRepository } from "@/domain/modeling/worker-backed-document-repository";
import { registerOpenCascadeAssetCache } from "@/domain/modeling/occ/asset-cache";
import {
	getBrowserOccKernelAdapter,
	startBrowserOccWarmup,
} from "@/domain/modeling/occ/browser-kernel-runtime";
import {
	OCC_KERNEL_DOCUMENT_ID,
} from "@/domain/modeling/opencascade-kernel-seed";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { EditorProvider } from "@/hooks/editor-provider";
import { ErrorReporterProvider } from "@/hooks/error-reporter-provider";
import { ModelingServiceProvider } from "@/hooks/modeling-service-provider";
import { ToolActionProvider } from "@/hooks/tool-action-provider";
import { createToolActionBus } from "@/domain/tools/tool-action-bus";
import { ReportedErrorBoundary } from "@/components/layout/reported-error-boundary";
import { BuildMetadataLabel } from "@/components/layout/build-metadata-label";
import { SentryAdBlockNotification } from "@/components/layout/sentry-ad-block-notification";
import { normalizeUnknownError } from "@/contracts/errors";
import { useErrorReporter } from "@/hooks/use-error-reporter";

function App() {
	const actionBus = useMemo(() => createToolActionBus(), []);
	const editorSketchSolver = useMemo(
		() =>
			new SketchConstraintSolverAdapter({
				documentId: OCC_KERNEL_DOCUMENT_ID,
				revisionId: null,
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
	const kernelAdapter = useMemo(() => getBrowserOccKernelAdapter(), []);
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
	const modelingService = useMemo(
		() =>
			createModelingService(kernelAdapter, {
				currentDocumentId: OCC_KERNEL_DOCUMENT_ID,
				sketchSolver: editorSketchSolver,
				operationHistoryStore:
					typeof window === "undefined"
						? null
						: createLocalStorageOperationHistoryStore(window.localStorage),
				documentRepositoryPersistence: "background",
				documentRepository:
					typeof window === "undefined" || shouldDisableDevRepository() || !documentSyncWorkerClient
						? null
						: createWorkerBackedDocumentRepository({
								client: documentSyncWorkerClient,
								urlStore: createLocalStorageDocumentRepositoryUrlStore(window.localStorage),
							}),
			}),
		[kernelAdapter, editorSketchSolver, documentSyncWorkerClient],
	);

	return (
		<ErrorReporterProvider>
			<ReportedErrorBoundary>
				<OccWarmupErrorEffect />
				<OccAssetCacheEffect />
				<ModelingServiceProvider modelingService={modelingService}>
					<EditorProvider modelingService={modelingService}>
						<ToolActionProvider actionBus={actionBus}>
							<CadWorkbench />
						</ToolActionProvider>
					</EditorProvider>
				</ModelingServiceProvider>
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

function OccWarmupErrorEffect() {
	const errorReporter = useErrorReporter();

	useEffect(() => {
		const warmupPromise = startBrowserOccWarmup();
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
	}, [errorReporter]);

	return null;
}

function shouldDisableDevRepository() {
	if (typeof window === "undefined") {
		return false;
	}

	return new URLSearchParams(window.location.search).get("cadDisableRepository") === "1";
}

export default App;
