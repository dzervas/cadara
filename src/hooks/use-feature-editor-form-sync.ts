import { useEffect, useRef } from "react";
import type { UseFormReturn } from "react-hook-form";

import {
  createFeatureEditorFormValues,
  normalizeFeatureEditorFormValues,
  shouldResetFeatureEditorFormValues,
  type FeatureEditorFormValues,
} from "@/core/feature-authoring/form-adapter";
import type { FeatureEditorFormSchema } from "@/core/feature-authoring/form-schema";

export function useFeatureEditorFormSync({
  sessionKey,
  formSchema,
  form,
}: {
  sessionKey: string | null;
  formSchema: FeatureEditorFormSchema | null;
  form: UseFormReturn<FeatureEditorFormValues>;
}): void {
  const lastSessionKeyRef = useRef<string | null>(null);
  const lastSyncedValuesRef = useRef<FeatureEditorFormValues>({});

  useEffect(() => {
    if (!sessionKey || !formSchema) {
      form.reset({});
      lastSessionKeyRef.current = null;
      lastSyncedValuesRef.current = {};
      return;
    }

    const nextValues = createFeatureEditorFormValues(formSchema);
    const currentValues = normalizeFeatureEditorFormValues(
      formSchema,
      form.getValues(),
    );

    if (
      shouldResetFeatureEditorFormValues({
        schema: formSchema,
        sessionKey,
        lastSessionKey: lastSessionKeyRef.current,
        currentValues,
        lastSyncedValues: lastSyncedValuesRef.current,
        nextValues,
      })
    ) {
      form.reset(nextValues);
    }

    lastSessionKeyRef.current = sessionKey;
    lastSyncedValuesRef.current = nextValues;
  }, [sessionKey, formSchema, form]);
}
