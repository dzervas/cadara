import typia from "typia";
import { requireContract } from "@/contracts/shared/validation";
import type {
  ProjectPresenceState,
  RemoteProject,
  SyncTokenClaims,
  SyncTokenResponse,
} from "./project-service";

// Service records carry more columns than the client reads; responses are
// validated for the fields used, not for equality.
const validateRemoteProject = typia.createValidate<RemoteProject>();
const validateRemoteProjects = typia.createValidate<RemoteProject[]>();
const validateSyncTokenResponse =
  typia.createValidateEquals<SyncTokenResponse>();
const validateSyncTokenClaims = typia.createValidate<SyncTokenClaims>();
const validateProjectPresenceState =
  typia.createValidateEquals<ProjectPresenceState>();

export function parseRemoteProject(input: unknown): RemoteProject {
  return requireContract(validateRemoteProject, input, "CADara project");
}

export function parseRemoteProjects(input: unknown): RemoteProject[] {
  return requireContract(validateRemoteProjects, input, "CADara projects");
}

export function parseSyncTokenResponse(input: unknown): SyncTokenResponse {
  const response = requireContract(
    validateSyncTokenResponse,
    input,
    "Sync token",
  );
  if (!response.token || !(response.expiresIn > 0))
    throw new Error("The sync token response is empty.");
  return response;
}

/** Reads the role claim of a `<base64url payload>.<signature>` sync token. */
export function parseSyncTokenClaims(token: string): SyncTokenClaims {
  const payload = token.split(".")[0] ?? "";
  let claims: unknown;
  try {
    claims = JSON.parse(
      atob(payload.replaceAll("-", "+").replaceAll("_", "/")),
    );
  } catch {
    throw new Error("The sync token is malformed.");
  }
  return requireContract(validateSyncTokenClaims, claims, "Sync token claims");
}

/** Presence arrives from other clients: anything malformed is ignored. */
export function readProjectPresenceState(
  input: unknown,
): ProjectPresenceState | null {
  const result = validateProjectPresenceState(input);
  return result.success ? result.data : null;
}
