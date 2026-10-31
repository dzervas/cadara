import { expect, it, vi } from "vitest";
import { MockKernelAdapter } from "@/application/modeling/mock-kernel-adapter";
import { MemoryDocumentRepository } from "@/application/modeling/memory-document-repository";
import { createSeedAuthoredModelDocument } from "@/application/modeling/modeling-test-fixtures";
import { createModelingService } from "./service";
import { isModelingServiceInitializationFailure } from "./initialization-failure";

// Lane: logic. Seam: the modeling service's rejections. Callers that hit a
// thrown initialization (project discovery, local file sync, refreshes) must
// recognise it to defer to the document's "could not be opened" notice; any
// other failure must stay their own.
it("marks the error of a thrown initialization, which every later call rejects with", async () => {
  const original = await createSeedAuthoredModelDocument();
  const adapter = new MockKernelAdapter();
  const initializationError = new Error("Geometry engine failed to start");
  vi.spyOn(adapter, "restoreAuthoredModelDocument").mockRejectedValueOnce(initializationError);
  const service = createModelingService(adapter, {
    currentDocumentId: original.documentId,
    documentRepository: new MemoryDocumentRepository([original]),
  });
  try {
    expect(isModelingServiceInitializationFailure(initializationError), "not before it is thrown").toBe(false);
    await expect(service.getCurrentDocumentSnapshot()).rejects.toBe(initializationError);
    expect(isModelingServiceInitializationFailure(initializationError)).toBe(true);
    await expect(service.restoreLocalFileBinding()).rejects.toBe(initializationError);
  } finally { service.dispose(); }
});

it("does not mark failures of an initialized service", async () => {
  const original = await createSeedAuthoredModelDocument();
  const adapter = new MockKernelAdapter();
  const service = createModelingService(adapter, {
    currentDocumentId: original.documentId,
    documentRepository: new MemoryDocumentRepository([original]),
  });
  try {
    await service.getCurrentDocumentSnapshot();
    const refreshError = new Error("Snapshot build failed");
    vi.spyOn(adapter, "getDocumentSnapshot").mockRejectedValueOnce(refreshError);
    await expect(service.getCurrentDocumentSnapshot()).rejects.toBe(refreshError);
    expect(isModelingServiceInitializationFailure(refreshError)).toBe(false);
  } finally { service.dispose(); }
});
