import { Component, type ErrorInfo, type PropsWithChildren } from "react";

import { normalizeUnknownError, type ErrorReporter } from "@/contracts/errors";
import { useErrorReporter } from "@/hooks/use-error-reporter";

interface ReportedErrorBoundaryState {
  message: string | null;
}

interface ReportedErrorBoundaryInnerProps extends PropsWithChildren {
  reporter: ErrorReporter;
}

class ReportedErrorBoundaryInner extends Component<
  ReportedErrorBoundaryInnerProps,
  ReportedErrorBoundaryState
> {
  state: ReportedErrorBoundaryState = { message: null };

  static getDerivedStateFromError(error: unknown): ReportedErrorBoundaryState {
    return {
      message: normalizeUnknownError(error, {
        code: "render/crash",
        fallbackMessage: "The workbench view crashed.",
      }).message,
    };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    const appError = normalizeUnknownError(error, {
      code: "render/crash",
      severity: "fatal",
      fallbackMessage: "The workbench view crashed.",
      context: [
        { key: "componentStack", value: errorInfo.componentStack || null },
      ],
      recoverable: false,
    });

    this.props.reporter.report(appError, {
      source: "react-error-boundary",
      visibility: "user",
      dedupeKey: `render:${appError.message}`,
    });
  }

  render() {
    if (this.state.message) {
      return (
        <div className="flex h-screen min-h-screen items-start justify-center bg-[var(--cad-background)] p-6 text-[var(--cad-foreground)]">
          <div
            role="alert"
            className="mt-16 max-w-md rounded-lg border border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] p-4 shadow-[var(--cad-panel-shadow)]"
          >
            <div className="text-sm font-semibold">Workbench view crashed</div>
            <div className="mt-2 text-xs text-[var(--cad-muted-foreground)]">
              {this.state.message}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function ReportedErrorBoundary({ children }: PropsWithChildren) {
  const reporter = useErrorReporter();

  return (
    <ReportedErrorBoundaryInner reporter={reporter}>
      {children}
    </ReportedErrorBoundaryInner>
  );
}
