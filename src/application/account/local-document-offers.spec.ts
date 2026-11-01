import { expect, test } from "vitest";
import { LocalDocumentOffers } from "./local-document-offers";

function preferences() {
  const suppressed = new Set<string>();
  return {
    isSuppressed: (id: string) => suppressed.has(id),
    suppress: (id: string) => {
      suppressed.add(id);
    },
  };
}

test("restoring, seeding and peer changes do not offer an account move; the first local edit does", () => {
  const offers = new LocalDocumentOffers(preferences());
  for (const source of ["restore", "seed", "reset", "peer"] as const)
    offers.recordChange("doc_part", source);
  expect(offers.isOffered("doc_part")).toBe(false);
  offers.recordChange("doc_part", "local");
  expect(offers.isOffered("doc_part")).toBe(true);
  expect(offers.isOffered("doc_other")).toBe(false);
});

test("dismissal suppresses both sign-in and later edit offers for only that document and session", () => {
  const saved = preferences();
  const offers = new LocalDocumentOffers(saved);
  offers.offer("doc_part");
  offers.dismiss("doc_part");
  offers.offer("doc_part");
  offers.recordChange("doc_part", "local");
  expect(offers.isOffered("doc_part")).toBe(false);
  offers.recordChange("doc_other", "local");
  expect(offers.isOffered("doc_other")).toBe(true);
  const nextSession = new LocalDocumentOffers(saved);
  nextSession.recordChange("doc_part", "local");
  expect(nextSession.isOffered("doc_part")).toBe(true);
});

test("don't ask persists for both triggers without suppressing other documents", () => {
  const saved = preferences();
  const offers = new LocalDocumentOffers(saved);
  offers.offer("doc_part");
  offers.dontAsk("doc_part");
  expect(offers.isOffered("doc_part")).toBe(false);
  const nextSession = new LocalDocumentOffers(saved);
  nextSession.offer("doc_part");
  nextSession.recordChange("doc_part", "local");
  expect(nextSession.isOffered("doc_part")).toBe(false);
  nextSession.offer("doc_other");
  expect(nextSession.isOffered("doc_other")).toBe(true);
});
