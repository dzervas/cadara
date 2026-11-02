import { useState } from "react";
import type { OrganizationPort } from "@/application/account/organization-port";
import {
  createTeam,
  type CreateTeamInput,
} from "@/application/account/create-team";
import type { Organization } from "@/contracts/account/organizations";
import { normalizeUnknownError } from "@/contracts/errors";
import type { CreateTeamFormProps } from "@/components/account/create-team-modal";
import { useErrorReporter } from "./use-error-reporter";

/** Where a created team whose checkout failed is shown, with a retry link. */
export const CHECKOUT_FAILED_MEMBERS_PATH =
  "/dashboard/members?checkout=failed";

/**
 * The Create team modal's flow. `onCreated` takes over the team that now
 * exists: it leaves for the hosted checkout, or, with no checkout (it could
 * not start), shows the team at CHECKOUT_FAILED_MEMBERS_PATH.
 */
export function useCreateTeam(
  port: OrganizationPort,
  onCreated: (organization: Organization, checkoutUrl: string | null) => void,
): CreateTeamFormProps & { opened: boolean; open: () => void } {
  const reporter = useErrorReporter();
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return {
    opened,
    busy,
    error,
    open: () => {
      setError(null);
      setOpened(true);
    },
    onCancel: () => setOpened(false),
    onSubmit: (input: CreateTeamInput) => {
      setBusy(true);
      setError(null);
      void createTeam(port, input)
        .then((result) => {
          // The team exists either way: the modal's work is done. A leave the
          // user cancels (unsaved work) keeps the page usable; checkout can be
          // retried from Usage & plan.
          setBusy(false);
          setOpened(false);
          if ("checkoutUrl" in result) {
            onCreated(result.organization, result.checkoutUrl);
            return;
          }
          // The Members page says the checkout failed; the cause goes to diagnostics.
          reporter.report(
            normalizeUnknownError(result.checkoutError, {
              code: "app/operation-failed",
              fallbackMessage: "Checkout could not start.",
            }),
            {
              source: "account",
              visibility: "developer",
              attachActiveDocumentPayload: false,
            },
          );
          onCreated(result.organization, null);
        })
        .catch((reason: unknown) => {
          setBusy(false);
          setError(reason instanceof Error ? reason.message : String(reason));
        });
    },
  };
}
