// UI lane (cadara-8p7o); seam: `useLocalSaveStatus`, the React read of a
// local save status source (one service or every open tab).
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";

import type { LocalSaveStatus } from "@/domain/modeling/modeling-service";
import { useLocalSaveStatus } from "@/hooks/use-local-save-status";

function SavingProbe({ status }: { status: LocalSaveStatus }) {
  const read = useLocalSaveStatus({
    getLocalSaveStatus: () => status,
    subscribeToLocalSaveStatus: () => () => undefined,
  });
  return <span data-saving={read.saving}>{read.failure?.message ?? ""}</span>;
}

test("useLocalSaveStatus renders the source's current status", () => {
  expect(
    renderToStaticMarkup(<SavingProbe status={{ saving: true, failure: null }} />),
  ).toBe('<span data-saving="true"></span>');
});
