import typia from "typia";
import { requireContract } from "@/contracts/shared/validation";
import type {
  BillingCheckout,
  Organization,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationMembers,
  OrganizationSummary,
} from "./organizations";

// Better Auth records carry more columns than the client reads; responses are
// validated for the fields used, not for equality.
const validateOrganization = typia.createValidate<Organization>();
const validateOrganizationSummaries =
  typia.createValidate<OrganizationSummary[]>();
const validateMember = typia.createValidate<OrganizationMember>();
const validateMembers = typia.createValidate<OrganizationMembers>();
const validateInvitation = typia.createValidate<OrganizationInvitation>();
const validateInvitations = typia.createValidate<OrganizationInvitation[]>();
const validateCheckout = typia.createValidate<BillingCheckout>();

export function parseOrganization(input: unknown): Organization {
  return requireContract(validateOrganization, input, "Organization");
}

export function parseOrganizationSummaries(
  input: unknown,
): OrganizationSummary[] {
  return requireContract(validateOrganizationSummaries, input, "Organizations");
}

export function parseOrganizationMember(input: unknown): OrganizationMember {
  return requireContract(validateMember, input, "Organization member");
}

export function parseOrganizationMembers(input: unknown): OrganizationMember[] {
  return requireContract(validateMembers, input, "Organization members")
    .members;
}

export function parseOrganizationInvitation(
  input: unknown,
): OrganizationInvitation {
  return requireContract(validateInvitation, input, "Organization invitation");
}

export function parseOrganizationInvitations(
  input: unknown,
): OrganizationInvitation[] {
  return requireContract(
    validateInvitations,
    input,
    "Organization invitations",
  );
}

export function parseBillingCheckout(input: unknown): BillingCheckout {
  return requireContract(validateCheckout, input, "Billing checkout");
}
