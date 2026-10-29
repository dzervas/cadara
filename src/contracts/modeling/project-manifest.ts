import type { DocumentId } from "@/contracts/shared/ids";

export interface ProjectEntry {
  name: string;
  kind: "part" | "readme" | "discussion" | "assembly";
  docId: DocumentId;
}

export interface ProjectVersion {
  label: string;
  createdAt: string;
  heads: Record<string, string[]>;
}

export interface ProjectManifest {
  format: "cadara-project";
  schemaVersion: 1;
  projectId: string;
  name: string;
  entries: ProjectEntry[];
  versions: ProjectVersion[];
  forkedFrom?: { projectId: string; version: string };
}

export interface ProjectReadmeDocument {
  format: "cadara-readme";
  schemaVersion: 1;
  markdown: string;
}

export interface ProjectDiscussionDocument {
  format: "cadara-discussion";
  schemaVersion: 1;
  annotations: Record<string, string>;
}

export type ProjectResult<T> =
  | { ok: true; value: T }
  | { ok: false; diagnostic: { reasonCode: string; message: string } };
