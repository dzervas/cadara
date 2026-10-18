export const recoveryBrowsers = [
  { value: "chrome", label: "Chrome / Brave / Chromium" },
  { value: "edge", label: "Microsoft Edge" },
  { value: "firefox", label: "Firefox" },
  { value: "safari", label: "Safari" },
  { value: "embedded", label: "In-app browser" },
  { value: "other", label: "Other / not sure" },
] as const;

export const recoveryPlatforms = [
  { value: "windows", label: "Windows" },
  { value: "mac", label: "macOS" },
  { value: "linux", label: "Linux" },
  { value: "ios", label: "iPhone / iPad" },
  { value: "android", label: "Android" },
  { value: "other", label: "Other / not sure" },
] as const;

export type RecoveryBrowser = (typeof recoveryBrowsers)[number]["value"];
export type RecoveryPlatform = (typeof recoveryPlatforms)[number]["value"];
export interface RecoveryProfile {
  browser: RecoveryBrowser;
  platform: RecoveryPlatform;
}

/** Detection selects guidance, not capabilities; the operator can correct it. */
export function detectRecoveryProfile(
  userAgent: string,
  maxTouchPoints = 0,
): RecoveryProfile {
  const ios =
    /iPad|iPhone|iPod/.test(userAgent) ||
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  return {
    browser: /Edg(?:e|A|iOS)?\//.test(userAgent)
      ? "edge"
      : /Firefox|FxiOS/.test(userAgent)
        ? "firefox"
        : /Chrome|CriOS|Chromium/.test(userAgent)
          ? "chrome"
          : /Safari/.test(userAgent)
            ? "safari"
            : "other",
    platform: ios
      ? "ios"
      : /Android/.test(userAgent)
        ? "android"
        : /Win/.test(userAgent)
          ? "windows"
          : /Mac/.test(userAgent)
            ? "mac"
            : /Linux/.test(userAgent)
              ? "linux"
              : "other",
  };
}

const browserSteps: Record<RecoveryBrowser, readonly string[]> = {
  chrome: [
    "Open Settings → System. Turn on “Use graphics acceleration when available”, then relaunch if prompted.",
    "Update your browser. If graphics still fail, open chrome://gpu and check the WebGL2 status. A blocked or unavailable status may need a graphics-driver update.",
  ],
  edge: [
    "In Edge Settings, search for “graphics acceleration” and enable it when available. Restart Edge if prompted.",
    "Update Edge. If graphics still fail, open edge://gpu and check the WebGL2 status.",
  ],
  firefox: [
    "Open Settings → General → Performance. Use recommended performance settings, or enable hardware acceleration when available. Restart Firefox.",
    "Update Firefox. Open about:support and check Graphics for WebGL 2 information and any reported driver blocks.",
  ],
  safari: [
    "Update Safari through macOS Software Update, then fully quit and reopen Safari.",
    "Close other graphics-heavy tabs and apps. If the problem continues, try a current Chrome or Firefox release to compare. Safari normally enables WebGL without an extra switch.",
  ],
  embedded: [
    "Open cadara.app directly in your full browser instead of an app’s embedded viewer.",
    "Update that browser and your operating system, then retry. Embedded viewers can have different graphics restrictions.",
  ],
  other: [
    "Update your browser, then fully quit and reopen it.",
    "Try a current Chrome, Edge, Firefox, or Safari release supported by your device. Your browser must be able to create a WebGL 2 context.",
  ],
};

const platformHelp: Record<RecoveryPlatform, string> = {
  windows:
    "Windows: install graphics-driver updates from Windows Update or your GPU manufacturer. Remote Desktop and virtual machines may expose limited graphics; try a local session.",
  mac: "macOS: graphics-driver updates come with macOS. Install available system updates. In a virtual machine or remote session, try locally.",
  linux:
    "Linux: update your distribution’s supported Mesa or proprietary GPU driver. Virtual machines, remote desktops, and headless sessions may not expose WebGL 2.",
  ios: "iPhone / iPad: there is no desktop-style acceleration switch. If graphics remain unavailable after an iOS/iPadOS update and restart, try a desktop or laptop.",
  android:
    "Android: update the browser and Android, close other apps, then restart the device if needed. Older devices may not support WebGL 2.",
  other:
    "Install supported operating-system and graphics-driver updates. Remote or virtual sessions may expose limited graphics; try a local session.",
};

const helpLinks: Record<RecoveryBrowser, string> = {
  chrome: "https://support.google.com/chrome/answer/95414",
  edge: "https://support.microsoft.com/microsoft-edge",
  firefox:
    "https://support.mozilla.org/en-US/kb/upgrade-graphics-drivers-use-hardware-acceleration",
  safari: "https://support.apple.com/102665",
  embedded: "https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API",
  other: "https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API",
};

export function getRecoveryGuide({ browser, platform }: RecoveryProfile) {
  let steps = browserSteps[browser];
  if (browser !== "embedded") {
    if (platform === "ios")
      steps = [
        "Update iOS or iPadOS, and update your browser from the App Store if an update is available.",
        "Open CADara directly in the browser, not inside another app. Close unused tabs and apps, then restart the browser and retry.",
      ];
    if (platform === "android")
      steps = [
        "Update your browser from its official app store, and install available Android updates.",
        "Open CADara directly in your browser. Close graphics-heavy apps and tabs, then restart the browser and retry. Desktop acceleration settings do not apply here.",
      ];
  }
  return {
    steps,
    platformHelp:
      platformHelp[platform] +
      " On a managed device, an administrator may control graphics settings.",
    helpUrl:
      platform === "ios"
        ? "https://support.apple.com/118575"
        : platform === "android"
          ? "https://support.google.com/android/answer/7680439"
          : helpLinks[browser],
  };
}

/** Clipboard denial is recoverable: reveal selectable details instead. */
export async function copyRecoveryDiagnostics(
  diagnostics: string,
  clipboard: Pick<Clipboard, "writeText"> | undefined,
  selectDetails: () => void,
): Promise<"copied" | "selectable"> {
  const result = clipboard
    ? await clipboard.writeText(diagnostics).then(
        () => "copied" as const,
        () => "selectable" as const,
      )
    : "selectable";
  if (result === "selectable") selectDetails();
  return result;
}
