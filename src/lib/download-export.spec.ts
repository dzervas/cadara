import { test, expect } from "vitest";

import type { DocumentExportSuccessResult } from "@/contracts/modeling/export";
import {
  downloadDocumentExportResult,
  type BrowserDownloadEnvironment,
} from "@/lib/download-export";

test("src/lib/download-export.spec.ts", () => {
  const clicked: string[] = [];
  const appended: string[] = [];
  const revoked: string[] = [];
  let capturedBlob: Blob | null = null;

  const environment: BrowserDownloadEnvironment = {
    document: {
      body: {
        appendChild: (element) => {
          appended.push(element.download);
        },
      },
      createElement: () => ({
        href: "",
        download: "",
        click() {
          clicked.push(this.download);
        },
        remove() {
          appended.push("removed");
        },
      }),
    },
    URL: {
      createObjectURL: (blob) => {
        capturedBlob = blob;
        return "blob:export";
      },
      revokeObjectURL: (url) => {
        revoked.push(url);
      },
    },
  };

  const result: DocumentExportSuccessResult = {
    ok: true,
    format: "step",
    filename: "part-1.step",
    extension: "step",
    mimeType: "model/step",
    payload: "STEP payload",
    diagnostics: [],
  };

  downloadDocumentExportResult(result, environment);

  expect(
    clicked.length,
    "Successful exports should trigger one download click.",
  ).toBe(1);
  expect(clicked[0], "Download should use the returned filename.").toBe(
    "part-1.step",
  );
  expect(
    capturedBlob?.type,
    "Download should use the returned MIME type.",
  ).toBe("model/step");
  expect(
    appended.includes("part-1.step"),
    "Download anchor should be attached before clicking.",
  ).toBeTruthy();
  expect(
    revoked[0],
    "Download object URL should be revoked after clicking.",
  ).toBe("blob:export");
});
