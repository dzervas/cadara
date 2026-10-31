import { AccountMenu } from "@/components/layout/account-menu";
import { useAccountSession } from "@/hooks/use-account-session";
import { getWorkbenchSessionPort } from "./workbench-session";

export function WorkbenchAccount({
  onError,
}: {
  onError: (message: string) => void;
}) {
  return (
    <AccountMenu {...useAccountSession(getWorkbenchSessionPort(), onError)} />
  );
}
