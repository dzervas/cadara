import { expect, test } from "vitest";
import {
  createNumberInputDraft,
  reduceNumberInputDraft,
  resolveNumberInputCommit,
  shouldSendNumberInput,
} from "./committed-number-input-draft";

// Lane: UI. Exercise the numeric field's draft/accepted-value transitions;
// actual keyboard, blur and Enter wiring are covered in the browser rows.
test("intermediate numeric edits retain their text without changing the accepted value", () => {
  let state = reduceNumberInputDraft(createNumberInputDraft(1), {
    type: "focus",
  });
  for (const text of ["", "0", "0.", "0.1", "0.15", "-0.15"]) {
    state = reduceNumberInputDraft(state, { type: "edit", text });
    expect(state.text).toBe(text);
    expect(state.accepted).toBe(1);
  }
  expect(resolveNumberInputCommit(state.text, {})).toBe(-0.15);
  state = reduceNumberInputDraft(state, { type: "finish" });
  state = reduceNumberInputDraft(state, { type: "accept", value: -0.15 });
  expect(state.text).toBe(-0.15);
});

test("rejected empty commits restore the accepted value even when it is unchanged", () => {
  let state = reduceNumberInputDraft(createNumberInputDraft(0.125), {
    type: "focus",
  });
  state = reduceNumberInputDraft(state, { type: "edit", text: "" });
  expect(resolveNumberInputCommit(state.text, {})).toBeNull();
  state = reduceNumberInputDraft(state, { type: "finish" });
  expect(state.text).toBe(0.125);
});

test("external accepted values resynchronize without interrupting active typing", () => {
  let state = reduceNumberInputDraft(createNumberInputDraft(1), {
    type: "accept",
    value: 2,
  });
  expect(state.text).toBe(2);
  state = reduceNumberInputDraft(state, { type: "focus" });
  state = reduceNumberInputDraft(state, { type: "edit", text: "0." });
  state = reduceNumberInputDraft(state, { type: "accept", value: 3 });
  expect(state.text).toBe("0.");
  expect(state.accepted).toBe(3);
  state = reduceNumberInputDraft(state, { type: "finish" });
  expect(state.text).toBe(3);
});

test("drafts reach the consumer live, but an unchanged value is never re-sent", () => {
  // Typing 0.5 over an accepted 0.1: the preview follows the first complete draft.
  let sent: number | null = 0.1;
  const sends: (number | null)[] = [];
  for (const text of ["", "0", "0.", "0.5"]) {
    const resolved = resolveNumberInputCommit(text, {});
    if (shouldSendNumberInput(resolved, sent)) {
      sends.push(resolved);
      sent = resolved;
    }
  }
  expect(sends).toEqual([null, 0, 0.5]);
  // Blur after Enter, or focus passing through the field with the draft
  // untouched, resolves to the value already sent: nothing is sent again.
  expect(shouldSendNumberInput(resolveNumberInputCommit("0.5", {}), sent)).toBe(
    false,
  );
  expect(shouldSendNumberInput(resolveNumberInputCommit(0.5, {}), 0.5)).toBe(
    false,
  );
});

test("a rejected draft resets the sent value to the accepted one, so an untouched focus round-trip sends nothing", () => {
  // The consumer keeps 0.125 when the empty draft is rejected: on finish the
  // field shows 0.125 again and the tracker returns to it.
  const accepted = 0.125;
  let sent: number | null = accepted;
  const cleared = resolveNumberInputCommit("", {});
  expect(shouldSendNumberInput(cleared, sent)).toBe(true);
  sent = cleared;
  let state = reduceNumberInputDraft(
    reduceNumberInputDraft(createNumberInputDraft(accepted), { type: "focus" }),
    { type: "edit", text: "" },
  );
  state = reduceNumberInputDraft(state, { type: "finish" });
  sent = state.accepted;
  expect(state.text).toBe(accepted);
  expect(
    shouldSendNumberInput(resolveNumberInputCommit(state.text, {}), sent),
  ).toBe(false);
});

test.each([
  ["0", 0.001],
  ["0.15", 0.15],
  ["", null],
  ["Infinity", null],
])(
  "commit validates %s without rejecting intermediate edits",
  (text, expected) => {
    expect(resolveNumberInputCommit(text!, { min: 0.001 })).toBe(expected);
  },
);
