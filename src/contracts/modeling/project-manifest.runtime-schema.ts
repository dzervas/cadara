import typia from "typia";
import type {
  ProjectEntry,
  ProjectManifest,
  ProjectResult,
} from "./project-manifest";

const validateProjectManifest = typia.createValidateEquals<ProjectManifest>();

/** Only the persistence migration accepts entries predating shared document identities. */
export type LegacyProjectManifest = Omit<ProjectManifest, "entries"> & {
  entries: (Omit<ProjectEntry, "automergeDocumentId"> & {
    automergeDocumentId?: string;
  })[];
};
export const validateLegacyProjectManifest =
  typia.createValidateEquals<LegacyProjectManifest>();

export function parseProjectManifest(
  value: unknown,
): ProjectResult<ProjectManifest> {
  const validated = validateProjectManifest(value);
  const invalid = (message: string): ProjectResult<ProjectManifest> => ({
    ok: false,
    diagnostic: { reasonCode: "invalid-project-manifest", message },
  });
  if (!validated.success)
    return invalid(
      `Invalid project manifest: ${validated.errors.map((error) => `${error.path}: expected ${error.expected}`).join("; ")}`,
    );
  const manifest = validated.data;
  if (!manifest.projectId.trim() || !manifest.name.trim())
    return invalid("Project identity and name must not be empty.");
  const ids = new Set<string>();
  const automergeIds = new Set<string>();
  let discussions = 0;
  for (const entry of manifest.entries) {
    if (!entry.name.trim() || !entry.docId.trim() || ids.has(entry.docId))
      return invalid(
        "Project entries require names and unique document identities.",
      );
    ids.add(entry.docId);
    if (
      !entry.automergeDocumentId.trim() ||
      automergeIds.has(entry.automergeDocumentId)
    )
      return invalid(
        "Project entries require unique Automerge document identities.",
      );
    automergeIds.add(entry.automergeDocumentId);
    if (entry.kind === "discussion") discussions++;
  }
  if (discussions > 1)
    return invalid("A project can have only one discussion document.");
  const labels = new Set<string>();
  for (const version of manifest.versions) {
    if (
      !version.label.trim() ||
      labels.has(version.label) ||
      !Number.isFinite(Date.parse(version.createdAt))
    )
      return invalid(
        "Named versions require unique labels and valid creation dates.",
      );
    labels.add(version.label);
    if (
      Object.entries(version.heads).some(
        ([id, heads]) =>
          !id.trim() ||
          heads.length === 0 ||
          heads.some((head) => !/^[a-f0-9]{64}$/.test(head)),
      )
    )
      return invalid(
        "Named versions require nonempty Automerge heads for every recorded document.",
      );
  }
  if (
    manifest.forkedFrom &&
    (!manifest.forkedFrom.projectId.trim() ||
      !manifest.forkedFrom.version.trim())
  )
    return invalid("Fork origins require a project identity and version.");
  if (
    manifest.service &&
    (!manifest.service.orgId.trim() || !manifest.service.projectId.trim())
  )
    return invalid(
      "Service links require an organization and a project identity.",
    );
  return { ok: true, value: manifest };
}
