import type { Account } from "@/contracts/account/account";
import type { SessionPort } from "./session-port";

/** In-process session for consumers that do not have a browser/API connection. */
export function createMemorySession(initial: Account | null = null) {
  let account = initial;
  const magicLinkRequests: string[] = [];
  const port: SessionPort = {
    async getAccount() {
      return account;
    },
    async requestMagicLink(email) {
      magicLinkRequests.push(email);
    },
    async signInSocial() {
      throw new Error("Social sign-in requires a browser.");
    },
    async signInPasskey() {
      throw new Error("Passkey sign-in requires a browser.");
    },
    async registerPasskey() {
      throw new Error("Passkey registration requires a browser.");
    },
    async signOut() {
      account = null;
    },
  };
  return {
    port,
    magicLinkRequests,
    completeSignIn(next: Account) {
      account = next;
    },
  };
}
