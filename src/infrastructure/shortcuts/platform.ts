export function getCurrentPlatform(): "mac" | "windows" | "linux" {
  if (typeof navigator === "undefined") {
    return "windows";
  }

  return /mac/i.test(navigator.platform) ? "mac" : "windows";
}
