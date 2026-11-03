import type { Account } from "@/contracts/account/account";

export interface SessionPort {
  getAccount(): Promise<Account | null>;
  /**
   * Sends the sign-in email, or reports that one was sent recently: in both
   * cases the address has a code, and `resendAfterSeconds` is the server's
   * wait before another email may be requested.
   */
  requestMagicLink(email: string): Promise<{ resendAfterSeconds: number }>;
  redeemEmailCode(email: string, code: string): Promise<void>;
  signInSocial(provider: "google" | "github"): Promise<void>;
  signInPasskey(options?: { autoFill: boolean }): Promise<void>;
  registerPasskey(): Promise<void>;
  signOut(): Promise<void>;
}
