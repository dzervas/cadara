import { expect, test } from "vitest";
import { nextRoomAllowList } from "./room-allow-list";

test("an entry the room has not acknowledged yet stays out of the allow-list", () => {
  const before = new Set(["part_a"]);
  expect(nextRoomAllowList(before, ["part_a", "part_b"], false)).toEqual(
    new Set(["part_a"]),
  );
});

test("the room acknowledging the current manifest admits every listed entry", () => {
  expect(
    nextRoomAllowList(new Set(["part_a"]), ["part_a", "part_b"], true),
  ).toEqual(new Set(["part_a", "part_b"]));
});

test("removed entries leave the allow-list before the room acknowledges the removal", () => {
  expect(
    nextRoomAllowList(new Set(["part_a", "part_b"]), ["part_a"], false),
  ).toEqual(new Set(["part_a"]));
});
