import { expect, test } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryDocumentRepository } from "@/application/modeling/memory-document-repository";
import type { DocumentRepositoryMutationResult } from "@/contracts/modeling/document-repository";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

class FailedImageRepository extends MemoryDocumentRepository {
  failNextWrite = false;
  override async mutate(
    input: Parameters<MemoryDocumentRepository["mutate"]>[0],
  ): Promise<DocumentRepositoryMutationResult> {
    const written = await super.mutate(input);
    if (!this.failNextWrite || !written.ok) return written;
    this.failNextWrite = false;
    return {
      ok: false,
      status: {
        kind: "failed",
        documentId: input.documentId,
        diagnostic: {
          reasonCode: "write-failed",
          message: "image persistence failed",
        },
      },
      appliedLive: { document: written.document, metadata: written.metadata },
    };
  }
}

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII=";

test("failed image publication persistence preserves actual applied state rather than claiming a committed transaction", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-image-persistence-"));
  const path = join(directory, "reference.png");
  await writeFile(path, Buffer.from(png, "base64"));
  let repository: FailedImageRepository;
  const w = await createSketchWorkflow({
    createRepository: (assets) =>
      (repository = new FailedImageRepository([], assets)),
  });
  try {
    const added = await w.execute({
      operation: "sketch.image.add",
      draft: w.current().discovery!.state.draft,
      path,
      intent: "fulfill",
    });
    repository!.failNextWrite = true;
    const failed = await w.run({
      operation: "sketch.publish",
      draft: added.discovery!.state.draft,
      requireProfiles: false,
    });
    expect(failed.outcome.kind).toBe("failed");
    expect(failed.completion.live.kind).toBe("applied");
    expect(failed.completion.persistence.kind).toBe("failed");
    expect(failed.completion.live.state!.revisionId).not.toBe(
      added.discovery!.state.revisionId,
    );
    expect(
      failed.diagnostics.some((d) =>
        d.message.includes("image persistence failed"),
      ),
    ).toBe(true);
    const inspected = await w.execute({ operation: "document.inspect" });
    expect(inspected.discovery!.state).toEqual(failed.completion.live.state);
    const reopened = await w.run({
      operation: "sketch.open",
      sketchId: failed.discovery!.sketch!.sketchId,
    });
    expect(
      reopened.discovery!.sketch!.referenceImages![0]!.ownedState.image
        .base64Data,
    ).toBe(png);
  } finally {
    await w.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);

test("native save failure after styled image publication is reported separately from retained live content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-image-file-failure-"));
  const path = join(directory, "reference.png");
  await writeFile(path, Buffer.from(png, "base64"));
  const w = await createSketchWorkflow({
    nativeFileIO: {
      async read() {
        throw new Error("no saved file");
      },
      async write() {
        return {
          kind: "failed",
          bytesWritten: 0,
          diagnostics: [
            {
              code: "file-write-failed",
              severity: "error",
              message: "image file write failed",
              target: null,
              detail: null,
            },
          ],
        };
      },
    },
  });
  try {
    const circle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const target = circle.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    await w.execute({
      operation: "sketch.style.patch",
      draft: circle.discovery!.state.draft,
      targets: [target],
      patch: { field: "strokeColor", value: "#123456" },
      intent: "fulfill",
    });
    const image = await w.execute({
      operation: "sketch.image.add",
      draft: w.current().discovery!.state.draft,
      path,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: image.discovery!.state.draft,
      requireProfiles: true,
    });
    const failed = await w.run({
      operation: "document.save",
      path: join(directory, "failed.cadara.json"),
    });
    expect(failed.outcome.kind).toBe("failed");
    expect(failed.completion.file.kind).toBe("failed");
    expect(failed.completion.live.kind).toBe("unchanged");
    expect(
      failed.diagnostics.some((d) =>
        d.message.includes("image file write failed"),
      ),
    ).toBe(true);
    const reopened = await w.execute({
      operation: "sketch.open",
      sketchId: published.discovery!.sketch!.sketchId,
    });
    expect(reopened.discovery!.sketch!.entities[0]!.style).toEqual({
      strokeColor: "#123456",
    });
    expect(
      reopened.discovery!.sketch!.referenceImages![0]!.ownedState.image
        .base64Data,
    ).toBe(png);
    expect(reopened.discovery!.sketch!.profiles).toHaveLength(1);
  } finally {
    await w.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
