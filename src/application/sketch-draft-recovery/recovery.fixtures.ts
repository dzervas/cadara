import { createNewSketchSession } from "@/domain/editor/sketch-session";
import { createStandardPlaneDefinition } from "@/core/modeling/opencascade-kernel-seed";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import type { PersistedSketchDraft } from "@/contracts/sketch/draft-recovery";
import { publishedSketchRevision } from "./rules";

export async function makeSketchDraftRecoveryFixture(published = false) {
  const snapshot = await createSeedDocumentSnapshot();
  const sketch = snapshot.document.sketches[0]!;
  const session = createNewSketchSession(createStandardPlaneDefinition("xy"), snapshot.document.settings);
  const draft: PersistedSketchDraft = {
    version: 1,
    documentId: snapshot.document.documentId,
    sketchId: published ? sketch.sketchId : session.actionContextId,
    published,
    publishedRevision: published ? publishedSketchRevision({
      sketchId: sketch.sketchId, label: sketch.label, plane: sketch.plane, definition: sketch.sketch.definition,
    }) : null,
    label: published ? sketch.label : session.sketchLabel,
    plane: published ? sketch.plane : session.plane,
    definition: published ? structuredClone(sketch.sketch.definition) : session.definition,
    sequence: 100,
    completedActions: 10,
    persistedAt: 1000,
  };
  return { snapshot, draft, session };
}
