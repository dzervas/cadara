import { Loader, Modal, Stack, Text } from "@mantine/core";
import type { ProjectAccessPort } from "@/application/account/project-access-port";
import type { Account } from "@/contracts/account/account";
import type { ProjectServiceLink } from "@/contracts/modeling/project-manifest";
import { useProjectAccess } from "@/hooks/use-project-access";
import {
  ProjectAccessLinks,
  ProjectAccessPeople,
} from "./project-access-sections";

/** The account project a Share dialog opens for. */
export interface ShareDialogTarget extends ProjectServiceLink {
  name: string;
}

export interface ShareDialogProps {
  port: ProjectAccessPort;
  account: Account | null;
  target: ShareDialogTarget | null;
  onClose: () => void;
  /** The user left the project from the dialog. */
  onLeft?: (target: ShareDialogTarget) => void;
}

export function ShareDialog({
  port,
  account,
  target,
  onClose,
  onLeft,
}: ShareDialogProps) {
  const access = useProjectAccess(port, target);
  return (
    <Modal
      opened={target !== null}
      onClose={onClose}
      title={target ? `Share ${target.name}` : "Share"}
      size="lg"
    >
      {target && (
        <Stack gap="xl">
          {access.loadError ? (
            <Text size="sm" c="red" role="alert">
              {access.loadError}
            </Text>
          ) : !access.people ? (
            <Loader size="sm" aria-label="Loading people" />
          ) : (
            <>
              <ProjectAccessPeople
                access={access}
                account={account}
                orgId={target.orgId}
                onLeft={() => {
                  onClose();
                  onLeft?.(target);
                }}
              />
              <ProjectAccessLinks access={access} />
            </>
          )}
        </Stack>
      )}
    </Modal>
  );
}
