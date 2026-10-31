import { expect, test } from "vitest";
import { readProjectPresenceState } from "./project-service.runtime-schema";

const presence = {
  userId: "user-peer",
  name: "Peer",
  activeDocumentId: "doc_part",
  role: "editor",
  selection: [{ kind: "face", bodyId: "body_part", faceId: "face_top" }],
};

test("presence accepts display roles and durable selections", () => {
  expect(readProjectPresenceState(presence)).toEqual(presence);
  expect(
    readProjectPresenceState({
      userId: "older",
      name: "Older client",
      activeDocumentId: null,
    }),
  ).not.toBeNull();
});

test.each([
  { ...presence, role: "superuser" },
  { ...presence, selection: [{ kind: "face", faceId: "face_top" }] },
  {
    ...presence,
    selection: [{ kind: "sketchTangentHandle", entityId: "entity_1" }],
  },
  { ...presence, selection: [{ kind: "body", bodyId: 7 }] },
  { ...presence, unknown: true },
])("malformed peer display data is dropped", (input) => {
  expect(readProjectPresenceState(input)).toBeNull();
});
