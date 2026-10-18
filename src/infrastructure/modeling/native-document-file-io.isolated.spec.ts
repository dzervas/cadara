import { expect, it, vi, beforeEach } from "vitest";

const disk = vi.hoisted(() => ({
  open: vi.fn(),
  write: vi.fn(),
  sync: vi.fn(),
  close: vi.fn(),
}));
vi.mock("node:fs/promises", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs/promises")>()),
  open: disk.open,
}));
import { filesystemNativeDocumentIO } from "./native-document-file-io";

beforeEach(() => {
  vi.resetAllMocks();
  disk.open.mockResolvedValue({
    write: disk.write,
    sync: disk.sync,
    close: disk.close,
  });
  disk.sync.mockResolvedValue(undefined);
  disk.close.mockResolvedValue(undefined);
});

it("writes binary bytes without decoding, retries partial writes and awaits sync then close", async () => {
  const bytes = new Uint8Array([255, 0, 128, 13, 10]);
  const events: string[] = [];
  disk.write.mockImplementation(async (actual, offset, length, position) => {
    expect(actual).toBe(bytes);
    expect(position).toBeNull();
    expect(length).toBe(bytes.length - offset);
    events.push(`write:${offset}`);
    return { bytesWritten: Math.min(2, length) };
  });
  disk.sync.mockImplementation(async () => {
    events.push("sync");
  });
  disk.close.mockImplementation(async () => {
    events.push("close");
  });
  expect(
    await filesystemNativeDocumentIO.writeBytes!("solid.stl", bytes),
  ).toEqual({ kind: "written", bytesWritten: 5, diagnostics: [] });
  expect(disk.open).toHaveBeenCalledWith("solid.stl", "w");
  expect(events).toEqual(["write:0", "write:2", "write:4", "sync", "close"]);
});

it("preserves observed partial bytes on a write failure and reports cleanup close failure", async () => {
  disk.write
    .mockResolvedValueOnce({ bytesWritten: 2 })
    .mockRejectedValueOnce(new Error("disk full"));
  disk.close.mockRejectedValue(new Error("close failed"));
  const result = await filesystemNativeDocumentIO.writeBytes!(
    "partial.3mf",
    new Uint8Array([255, 128, 1]),
  );
  expect(result.kind).toBe("failed");
  expect(result.bytesWritten).toBe(2);
  expect(result.diagnostics.map((d) => d.message)).toEqual([
    "disk full",
    "close failed",
  ]);
  expect(disk.sync).not.toHaveBeenCalled();
});

it("does not call full bytes a successful file if sync or close fails", async () => {
  disk.write.mockResolvedValue({ bytesWritten: 3 });
  disk.sync.mockRejectedValueOnce(new Error("sync failed"));
  const sync = await filesystemNativeDocumentIO.writeBytes!(
    "sync",
    new Uint8Array(3),
  );
  expect(sync).toMatchObject({ kind: "failed", bytesWritten: 3 });
  expect(sync.diagnostics.map((d) => d.message)).toEqual(["sync failed"]);
  disk.sync.mockResolvedValue(undefined);
  disk.close.mockRejectedValueOnce(new Error("close failed"));
  const close = await filesystemNativeDocumentIO.writeBytes!(
    "close",
    new Uint8Array(3),
  );
  expect(close).toMatchObject({ kind: "failed", bytesWritten: 3 });
  expect(close.diagnostics.map((d) => d.message)).toEqual(["close failed"]);
});

it("reports open and no-progress failures with only observed bytes; text uses the same writer", async () => {
  disk.open.mockRejectedValueOnce(new Error("denied"));
  expect(
    await filesystemNativeDocumentIO.writeBytes!("denied", new Uint8Array(3)),
  ).toMatchObject({ kind: "failed", bytesWritten: 0 });
  disk.write.mockResolvedValueOnce({ bytesWritten: 0 });
  const stalled = await filesystemNativeDocumentIO.write("text", "é");
  expect(stalled).toMatchObject({ kind: "failed", bytesWritten: 0 });
  expect(disk.write.mock.calls[0]![0]).toEqual(new TextEncoder().encode("é"));
  expect(stalled.diagnostics[0]!.message).toContain("no progress");
});
