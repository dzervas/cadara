import { useCallback, useEffect, useState } from "react";

import { createAppError, errorContext, type ErrorReporter } from "@/contracts/errors";
import type { ModelingService } from "@/domain/modeling/modeling-service";
import type { WorkbenchNotificationModel } from "@/components/layout/workbench-notification-model";

interface WorkbenchNotificationsInput {
	errorReporter: ErrorReporter;
	modelingService: Pick<ModelingService, "getHistoryRestoreState">;
}

export function useWorkbenchNotifications({
	errorReporter,
	modelingService,
}: WorkbenchNotificationsInput) {
	const [restoreMessage, setRestoreMessage] = useState<string | null>(null);
	const [workbenchStatusNotification, setWorkbenchStatusNotification] =
		useState<WorkbenchNotificationModel | null>(null);

	const showWorkbenchInfo = useCallback((message: string) => {
		setWorkbenchStatusNotification({
			type: "info",
			title: "Workbench action",
			message,
		});
	}, []);

	const showWorkbenchError = useCallback((message: string) => {
		setWorkbenchStatusNotification({
			type: "error",
			title: "Workbench action failed",
			message,
		});
	}, []);

	const reportDocumentFileActionFailure = useCallback(
		(source: string, message: string, error: unknown) => {
			showWorkbenchError(message);
			errorReporter.report(
				createAppError({
					code: "workbench/action-failed",
					message,
					context: errorContext(
						"reason",
						error instanceof Error ? error.message : "Unknown failure",
					),
					cause: error,
				}),
				{
					source,
					visibility: "user",
				},
			);
		},
		[errorReporter, showWorkbenchError],
	);

	useEffect(() => {
		let disposed = false;

		void modelingService.getHistoryRestoreState().then((state) => {
			if (disposed) {
				return;
			}

			setRestoreMessage(
				state.kind === "failed"
					? (state.diagnostics[0]?.message ?? "Operation history restore failed.")
					: null,
			);
		});

		return () => {
			disposed = true;
		};
	}, [modelingService]);

	return {
		reportDocumentFileActionFailure,
		restoreMessage,
		setRestoreMessage,
		setWorkbenchStatusNotification,
		showWorkbenchError,
		showWorkbenchInfo,
		workbenchStatusNotification,
	};
}
