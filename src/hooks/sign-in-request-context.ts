import { createContext } from "react";
import { createRequiredContextHook } from "./create-required-context-hook";

/**
 * Account-gated actions (a New project account card, and later Share,
 * Upload and Change plan) ask for a sign-in through this seam; whichever
 * sign-in surface is mounted answers it. Today the account menu opens itself.
 */
export interface SignInRequest {
  requestSignIn(): void;
  /** Registers the surface that answers requests; the result unregisters it. */
  answerSignInRequests(answer: () => void): () => void;
}

export const SignInRequestContext = createContext<SignInRequest | null>(null);

export const useSignInRequest = createRequiredContextHook(
  SignInRequestContext,
  "useSignInRequest",
  "SignInRequestProvider",
);
