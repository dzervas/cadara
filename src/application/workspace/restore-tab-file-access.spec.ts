import { expect, test, vi } from "vitest";
import type { LocalFileSystemFileHandle } from "@/contracts/modeling/local-file-system-access";
import { restoreTabFileAccess } from "./restore-tab-file-access";

function fileHandle(): LocalFileSystemFileHandle {
  return { name: "Bracket.cadara", getFile: vi.fn(), createWritable: vi.fn() };
}

test("restoring access requests the existing handle synchronously within the click and retries only after permission is granted", async () => {
  let grant!: (permission: "granted") => void;
  const handle = fileHandle();
  handle.requestPermission = vi.fn(
    () =>
      new Promise<"granted">((resolve) => {
        grant = resolve;
      }),
  );
  const retry = vi.fn(async () => undefined);
  const restored = restoreTabFileAccess(handle, retry);
  expect(handle.requestPermission).toHaveBeenCalledWith({ mode: "readwrite" });
  expect(retry).not.toHaveBeenCalled();
  grant("granted");
  expect(await restored).toBe("granted");
  expect(retry).toHaveBeenCalledOnce();
  expect(handle.createWritable).not.toHaveBeenCalled();
  expect(handle.getFile).not.toHaveBeenCalled();
});

test("denied or missing access never writes or retries, so the UI can offer explicit re-linking", async () => {
  const handle = fileHandle();
  const retry = vi.fn(async () => undefined);
  expect(await restoreTabFileAccess(handle, retry)).toBe("missing");
  handle.requestPermission = async () => "denied";
  expect(await restoreTabFileAccess(handle, retry)).toBe("denied");
  expect(retry).not.toHaveBeenCalled();
  expect(handle.createWritable).not.toHaveBeenCalled();
});
