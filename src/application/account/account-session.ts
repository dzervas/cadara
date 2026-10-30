import type { Account } from "@/contracts/account/account";
import type { SessionPort } from "./session-port";

export interface AccountSessionState {
  account: Account | null;
  offline: boolean;
}

export async function hydrateAccountSession(
  port: SessionPort,
): Promise<AccountSessionState> {
  return { account: await port.getAccount(), offline: false };
}

export async function signInAccountWithPasskey(
  port: SessionPort,
): Promise<AccountSessionState> {
  await port.signInPasskey();
  return hydrateAccountSession(port);
}
