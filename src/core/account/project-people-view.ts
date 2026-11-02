import type { Account, ProjectRole } from "@/contracts/account/account";
import type {
  ProjectGrantedPerson,
  ProjectPeople,
  ProjectPersonIdentity,
  ProjectVersionSummary,
} from "@/contracts/account/project-access";

export const PROJECT_ROLES: readonly ProjectRole[] = [
  "admin",
  "editor",
  "commenter",
  "viewer",
];

export const PROJECT_ROLE_LABELS: Record<ProjectRole, string> = {
  admin: "Admin",
  editor: "Editor",
  commenter: "Commenter",
  viewer: "Viewer",
};

/** Roles that take one of the plan's per-project editor slots. */
export function takesEditorSlot(role: ProjectRole) {
  return role === "admin" || role === "editor";
}

export interface ProjectPersonRow extends ProjectPersonIdentity {
  userId: string;
  /** The owner's role is fixed; everyone else's comes from their grant. */
  role: ProjectRole;
  owner: boolean;
  you: boolean;
}

/**
 * The people box: the owner of a personal project first, then everyone with an
 * explicit role. Team projects belong to the team, whose access is its own row.
 */
export function projectPersonRows(
  people: ProjectPeople,
  userId: string | null,
): ProjectPersonRow[] {
  const granted = (person: ProjectGrantedPerson): ProjectPersonRow => ({
    userId: person.user_id,
    name: person.name,
    email: person.email,
    image: person.image,
    role: person.role,
    owner: false,
    you: person.user_id === userId,
  });
  const owner =
    people.organization.personal && people.owner
      ? [
          {
            userId: people.owner.user_id,
            name: people.owner.name,
            email: people.owner.email,
            image: people.owner.image,
            role: "admin" as const,
            owner: true,
            you: people.owner.user_id === userId,
          },
        ]
      : [];
  return [...owner, ...people.people.map(granted)];
}

/** The owner as people it is shared with know them. */
export function projectOwnerName(people: ProjectPeople) {
  if (!people.organization.personal) return people.organization.name;
  return people.owner?.name || people.owner?.email || "";
}

/**
 * Only people invited individually from outside the organization leave a
 * project; team members get their access from the team and leave the team.
 */
export function canLeaveProject(account: Account | null, orgId: string) {
  return (
    account?.me.actor.memberships.some(
      (membership) =>
        membership.organizationId === orgId &&
        membership.role === "collaborator",
    ) ?? false
  );
}

/** Whether the user owns the organization, so a plan change is theirs to make. */
export function ownsOrganization(account: Account | null, orgId: string) {
  return (
    account?.me.actor.memberships.some(
      (membership) =>
        membership.organizationId === orgId && membership.role === "owner",
    ) ?? false
  );
}

/**
 * The editors-vs-limit reading when inviting with `role` would go over the
 * plan's per-project limit (pending invites count); null when it fits.
 */
export function editorLimitReached(
  people: ProjectPeople,
  role: ProjectRole,
): { limit: number; used: number } | null {
  if (!people.editors || !takesEditorSlot(role)) return null;
  return people.editors.used >= people.editors.limit ? people.editors : null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * "expires in 14 days" for a pending invite, to the nearest day: `now` may be
 * read a little before the invite was sent. The service drops expired invites.
 */
export function inviteExpiryLabel(expiresAt: number, now: number) {
  const days = Math.max(1, Math.round((expiresAt - now) / DAY_MS));
  return `expires in ${days} ${days === 1 ? "day" : "days"}`;
}

/** Up to two initials for an avatar, from the name or else the email. */
export function personInitials(person: ProjectPersonIdentity) {
  const words = (person.name.trim() || person.email).split(/[\s@.]+/);
  return words
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

/** Publishing always includes one of these viewable models, in this order. */
const SHAREABLE_FILES = ["mesh.glb", "mesh.gltf", "mesh.3mf"];

/**
 * What a project's share link opens: the model of its latest published
 * version; null until a version is published.
 */
export function latestShareableFile(
  versions: readonly ProjectVersionSummary[],
): { versionId: string; fileName: string } | null {
  const [latest] = versions
    .filter((version) => version.bundle_state === "complete")
    .sort((a, b) => b.created_at - a.created_at);
  const fileName = SHAREABLE_FILES.find((name) =>
    latest?.files.some((file) => file.name === name),
  );
  return latest && fileName ? { versionId: latest.id, fileName } : null;
}
