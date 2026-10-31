import type { LocalFileSystemFileHandle } from "@/contracts/modeling/local-file-system-access";

/** Must be called directly by the Restore access click, before any asynchronous work. */
export async function restoreTabFileAccess(
  handle: LocalFileSystemFileHandle,
  retry: () => Promise<void>,
): Promise<"granted" | "denied" | "missing"> {
  if (!handle.requestPermission) return "missing";
  const permission = await handle.requestPermission({ mode: "readwrite" });
  if (permission !== "granted") return "denied";
  await retry();
  return "granted";
}
