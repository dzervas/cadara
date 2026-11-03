import { useLayoutEffect, useReducer, useRef } from "react";
import { NumberInput, type NumberInputProps } from "@mantine/core";
import {
  createNumberInputDraft,
  reduceNumberInputDraft,
  resolveNumberInputCommit,
  shouldSendNumberInput,
} from "./committed-number-input-draft";

/**
 * Keep numeric drafts local: an intermediate string such as `0` or `0.` stays
 * in the field instead of being coerced, while the value each draft resolves
 * to (a number, or null for an empty or invalid draft) reaches the consumer as
 * soon as it differs from what the consumer last received, so a preview and
 * its validation follow the typing. Blur and Enter end the draft and restore
 * the accepted text when the draft was rejected; they never re-send an
 * unchanged value, so focus merely passing through the field (a chooser
 * opening, a tab change) does not patch the consumer.
 */
export function CommittedNumberInput({
  value,
  onCommit,
  ...props
}: Omit<NumberInputProps, "value" | "defaultValue" | "onChange"> & {
  value: number | null;
  onCommit: (value: number | null) => void;
}) {
  const [draft, dispatch] = useReducer(
    reduceNumberInputDraft,
    value,
    createNumberInputDraft,
  );
  // The last value handed to the consumer, so repeated drafts that resolve to
  // the same value (and a blur after Enter) are not re-sent.
  const sentRef = useRef<number | null>(value);
  useLayoutEffect(() => {
    sentRef.current = value;
    dispatch({ type: "accept", value });
  }, [value]);
  const send = (text: string | number) => {
    const resolved = resolveNumberInputCommit(text, props);
    if (!shouldSendNumberInput(resolved, sentRef.current)) return;
    sentRef.current = resolved;
    onCommit(resolved);
  };
  return (
    <NumberInput
      {...props}
      value={draft.text}
      onChange={(text) => {
        dispatch({ type: "edit", text });
        send(text);
      }}
      onFocus={(event) => {
        dispatch({ type: "focus" });
        props.onFocus?.(event);
      }}
      onBlur={(event) => {
        send(event.currentTarget.value);
        // A rejected draft restores the accepted text; the consumer still
        // holds the accepted value, so the next blur compares against it.
        sentRef.current = value;
        dispatch({ type: "finish" });
        props.onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          event.currentTarget.blur();
        }
        props.onKeyDown?.(event);
      }}
    />
  );
}
