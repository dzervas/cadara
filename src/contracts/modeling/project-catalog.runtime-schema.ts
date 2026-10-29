import typia from "typia";

export interface ProjectCatalog {
  format: "cadara-project-catalog";
  schemaVersion: 1;
  projects: { projectId: string; url: string }[];
}

export const validateProjectCatalog =
  typia.createValidateEquals<ProjectCatalog>();
