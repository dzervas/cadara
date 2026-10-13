import { readFile, open } from "node:fs/promises";
import type { NativeDocumentFileIO } from "@/application/semantic/document-port";
import { semanticDiagnostic } from "@/application/semantic/session";

/** Counts observed writes, including partial failures; completion includes sync and close. */
export const filesystemNativeDocumentIO: NativeDocumentFileIO = {
  read: (path) => readFile(path, "utf8"),
  async write(path, text) {
    let bytesWritten = 0;
    let handle: Awaited<ReturnType<typeof open>> | null = null;
    try {
      handle = await open(path, "w");
      const bytes = new TextEncoder().encode(text);
      while (bytesWritten < bytes.length) {
        const written = await handle.write(
          bytes,
          bytesWritten,
          bytes.length - bytesWritten,
          null,
        );
        if (!written.bytesWritten)
          throw new Error("Native file write made no progress.");
        bytesWritten += written.bytesWritten;
      }
      await handle.sync();
      await handle.close();
      handle = null;
      return { kind: "written", bytesWritten, diagnostics: [] };
    } catch (error) {
      const diagnostics = [semanticDiagnostic(error)];
      if (handle) {
        try {
          await handle.close();
        } catch (closeError) {
          diagnostics.push(semanticDiagnostic(closeError));
        }
      }
      return { kind: "failed", bytesWritten, diagnostics };
    }
  },
};
