import { expect, test } from "vitest";
import { summarizeQuota, type AccountQuota } from "./quota-summary";

function quota(
  storage: number,
  projects = 0,
  limit: number | null = 5,
): AccountQuota {
  return {
    organizationId: "personal",
    entitlements: {
      tier: "free",
      storage_limit_bytes: 1_000_000_000,
      private_project_limit: limit,
      project_editor_limit: 1,
      seat_count: 1,
    },
    usage: { storage_bytes: storage, private_projects: projects },
  };
}

test("storage warns strictly above 80% and turns red only over quota", () => {
  expect(summarizeQuota(quota(800_000_000)).severity).toBe("normal");
  expect(summarizeQuota(quota(800_000_001)).severity).toBe("warning");
  expect(summarizeQuota(quota(1_000_000_000))).toMatchObject({
    severity: "warning",
    storageAtLimit: true,
  });
  expect(summarizeQuota(quota(1_000_000_001))).toMatchObject({
    severity: "over",
    storagePercent: 100,
  });
});

test("private project limits contribute to the warning and creation availability", () => {
  expect(summarizeQuota(quota(0, 4)).severity).toBe("normal");
  expect(summarizeQuota(quota(0, 5))).toMatchObject({
    severity: "warning",
    privateProjectsAtLimit: true,
  });
  expect(summarizeQuota(quota(0, 6)).severity).toBe("over");
  expect(summarizeQuota(quota(0, 100, null))).toMatchObject({
    severity: "normal",
    privateProjectsAtLimit: false,
  });
  expect(summarizeQuota(quota(0, 0, 0)).privateProjectsAtLimit).toBe(true);
});

test("summary gives readable storage and private-project usage", () => {
  expect(summarizeQuota(quota(412_000_000, 3))).toMatchObject({
    storageLabel: "412 MB of 1 GB",
    privateProjectsLabel: "3 of 5 private projects",
  });
});
