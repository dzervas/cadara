import type { ImportProvider } from "@/contracts/import/provider";
import type { ResolvedImportSource } from "@/contracts/import/source";
import type { FeatureEditorFormSchema } from "@/core/feature-authoring/form-schema";

export interface ImportProviderRegistry {
  getAll(): readonly ImportProvider<
    unknown,
    unknown,
    FeatureEditorFormSchema
  >[];
  getById(
    providerId: string,
  ): ImportProvider<unknown, unknown, FeatureEditorFormSchema> | null;
  matchProviders(
    source: ResolvedImportSource,
  ): readonly ImportProvider<unknown, unknown, FeatureEditorFormSchema>[];
  getAcceptedFileTypes(): readonly { extension: string; mediaType?: string }[];
}

export function createImportProviderRegistry(
  providers: readonly ImportProvider<
    unknown,
    unknown,
    FeatureEditorFormSchema
  >[],
): ImportProviderRegistry {
  const dedupedProviders: ImportProvider<
    unknown,
    unknown,
    FeatureEditorFormSchema
  >[] = [];
  const providersById = new Map<
    string,
    ImportProvider<unknown, unknown, FeatureEditorFormSchema>
  >();

  for (const provider of providers) {
    if (providersById.has(provider.id)) {
      continue;
    }

    providersById.set(provider.id, provider);
    dedupedProviders.push(provider);
  }

  const acceptedFileTypes = collectAcceptedImportFileTypes(dedupedProviders);

  return {
    getAll() {
      return dedupedProviders;
    },
    getById(providerId) {
      return providersById.get(providerId) ?? null;
    },
    matchProviders(source) {
      return dedupedProviders.filter((provider) => provider.accepts(source));
    },
    getAcceptedFileTypes() {
      return acceptedFileTypes;
    },
  };
}

function collectAcceptedImportFileTypes(
  providers: readonly ImportProvider<
    unknown,
    unknown,
    FeatureEditorFormSchema
  >[],
) {
  const deduped = new Map<string, { extension: string; mediaType?: string }>();

  for (const provider of providers) {
    for (const acceptedType of provider.acceptedFileTypes) {
      const extension = acceptedType.extension
        .trim()
        .replace(/^\./, "")
        .toLowerCase();
      const mediaType = acceptedType.mediaType?.trim().toLowerCase();

      if (!extension) {
        continue;
      }

      const key = `${extension}:${mediaType ?? ""}`;
      if (!deduped.has(key)) {
        deduped.set(key, { extension, ...(mediaType ? { mediaType } : {}) });
      }
    }
  }

  return [...deduped.values()];
}
