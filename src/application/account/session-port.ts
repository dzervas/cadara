import type { Account } from "@/contracts/account/account";

export interface SessionPort {
  getAccount(): Promise<Account | null>;
  requestMagicLink(email: string): Promise<void>;
  redeemEmailCode(email: string, code: string): Promise<void>;
  signInSocial(provider: "google" | "github"): Promise<void>;
  signInPasskey(options?: { autoFill: boolean }): Promise<void>;
  registerPasskey(): Promise<void>;
  signOut(): Promise<void>;
}
