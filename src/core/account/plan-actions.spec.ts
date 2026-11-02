// Logic lane: which plan action each workspace may take from the Usage & plan page.
import { expect, test } from "vitest";
import {
  canOpenBillingPortal,
  planCardAction,
  type PlanWorkspace,
} from "./plan-actions";

const workspace = (overrides: Partial<PlanWorkspace>): PlanWorkspace => ({
  tier: "free",
  personal: true,
  canManageBilling: true,
  ...overrides,
});

test("a free personal workspace upgrades to Pro and is pointed at a team for Team", () => {
  const personal = workspace({});
  expect(planCardAction(personal, "free")).toEqual({ kind: "current" });
  expect(planCardAction(personal, "individual")).toEqual({
    kind: "checkout",
    tier: "individual",
  });
  expect(planCardAction(personal, "team")).toEqual({ kind: "create-team" });
  expect(canOpenBillingPortal(personal)).toBe(false);
});

test("a free team workspace upgrades to Team only", () => {
  const team = workspace({ personal: false });
  expect(planCardAction(team, "individual")).toEqual({ kind: "none" });
  expect(planCardAction(team, "team")).toEqual({
    kind: "checkout",
    tier: "team",
  });
});

test("paid workspaces change plan through the portal, never a second checkout", () => {
  for (const paid of [
    workspace({ tier: "individual" }),
    workspace({ tier: "team", personal: false }),
  ]) {
    expect(canOpenBillingPortal(paid)).toBe(true);
    expect(planCardAction(paid, paid.tier)).toEqual({ kind: "current" });
    for (const tier of ["free", "individual", "team"] as const)
      if (tier !== paid.tier)
        expect(planCardAction(paid, tier)).toEqual({ kind: "none" });
  }
});

test("members who cannot manage billing see the plan without actions", () => {
  for (const member of [
    workspace({ personal: false, canManageBilling: false }),
    workspace({ tier: "team", personal: false, canManageBilling: false }),
  ]) {
    expect(canOpenBillingPortal(member)).toBe(false);
    for (const tier of ["free", "individual", "team"] as const)
      expect(planCardAction(member, tier).kind).toMatch(/^(current|none)$/);
  }
});
