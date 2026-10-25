// UI lane (docs/testing.md). Seam: the dismissible storage-durability
// warning's presentation; when it is shown is proven in
// src/application/workspace/storage-durability.spec.ts.
import { expect, test } from "vitest";

import { getStorageDurabilityNotification } from "@/workbench/adapters/use-storage-durability-warning";

test("both storage warnings are dismissible, stay until dismissed and suggest exporting", () => {
  for (const warning of ["not-persisted", "low-space"] as const) {
    const notification = getStorageDurabilityNotification(warning, () => {});
    expect(notification).toMatchObject({
      type: "warning",
      persistent: true,
    });
    expect(notification.onDismiss).toBeTypeOf("function");
    expect(notification.message).toContain(
      "Save As > Download a copy in the file menu",
    );
  }
});
