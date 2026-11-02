import typia from "typia";
import { requireContract } from "@/contracts/shared/validation";
import type {
  ProjectDetails,
  ProjectInviteOutcome,
  ProjectPeople,
  ProjectShareLink,
  ProjectVersionSummary,
} from "./project-access";

// Service records carry more fields than the client reads; responses are
// validated for the fields used, not for equality.
const validateProjectDetails = typia.createValidate<ProjectDetails>();
const validateProjectPeople = typia.createValidate<ProjectPeople>();
const validateProjectInviteOutcome =
  typia.createValidate<ProjectInviteOutcome>();
const validateProjectVersions = typia.createValidate<ProjectVersionSummary[]>();
const validateProjectShareLink = typia.createValidate<ProjectShareLink>();

export function parseProjectDetails(input: unknown): ProjectDetails {
  return requireContract(validateProjectDetails, input, "CADara project");
}

export function parseProjectPeople(input: unknown): ProjectPeople {
  return requireContract(validateProjectPeople, input, "Project people");
}

export function parseProjectInviteOutcome(
  input: unknown,
): ProjectInviteOutcome {
  return requireContract(validateProjectInviteOutcome, input, "Project invite");
}

export function parseProjectVersions(input: unknown): ProjectVersionSummary[] {
  return requireContract(validateProjectVersions, input, "Project versions");
}

export function parseProjectShareLink(input: unknown): ProjectShareLink {
  return requireContract(validateProjectShareLink, input, "Share link");
}
