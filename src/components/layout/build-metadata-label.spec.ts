import { describe, expect, test } from "bun:test";

import {
  formatBuildMetadata,
  getBuildModeLabel,
} from "@/components/layout/build-metadata";

describe("formatBuildMetadata", () => {
  test("includes version, commit, and visible runtime mode", () => {
    expect(
      formatBuildMetadata({ version: "1.2.3", commit: "abc1234", mode: "dev" }),
    ).toBe("v1.2.3 abc1234 dev");
  });

  test("omits production mode", () => {
    expect(
      formatBuildMetadata({ version: "1.2.3", commit: "abc1234", mode: null }),
    ).toBe("v1.2.3 abc1234");
  });
});

describe("getBuildModeLabel", () => {
  test("normalizes development mode to dev", () => {
    expect(getBuildModeLabel("development", true)).toBe("dev");
  });

  test("keeps preview mode visible", () => {
    expect(getBuildModeLabel("preview", false)).toBe("preview");
  });

  test("hides regular production mode", () => {
    expect(getBuildModeLabel("production", false)).toBeNull();
  });
});
