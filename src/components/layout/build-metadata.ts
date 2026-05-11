interface BuildMetadata {
  version: string;
  commit: string;
  mode: string | null;
}

export function getBuildModeLabel(mode: string, isDev: boolean) {
  if (isDev) {
    return "dev";
  }

  if (mode === "preview") {
    return "preview";
  }

  return mode === "production" ? null : mode;
}

export function formatBuildMetadata({ version, commit, mode }: BuildMetadata) {
  return [`v${version}`, commit, mode].filter(Boolean).join(" ");
}
