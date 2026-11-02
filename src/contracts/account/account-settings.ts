export type ApiKeyScope =
  | "project:read"
  | "project:write"
  | "project:create"
  | "project:delete"
  | "org:admin";

export interface ApiKeyMetadata {
  organizationId: string;
  scopes: ApiKeyScope[];
  projectAllowList?: string[];
}

/** One row of GET /orgs/:orgId/api-keys; the secret is never listed. */
export interface ApiKeySummary {
  id: string;
  name: string | null;
  prefix: string | null;
  metadata: ApiKeyMetadata | null;
  createdAt: string;
  expiresAt: string | null;
}

/** POST /orgs/:orgId/api-keys: the only response that carries the secret. */
export interface CreatedApiKey {
  id: string;
  key: string;
  name: string;
  prefix: string | null;
  metadata: ApiKeyMetadata;
}
