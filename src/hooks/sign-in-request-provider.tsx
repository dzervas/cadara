import { useState, type PropsWithChildren } from "react";
import {
  SignInRequestContext,
  type SignInRequest,
} from "./sign-in-request-context";

/** One sign-in surface answers at a time: the most recently registered. */
export function SignInRequestProvider({ children }: PropsWithChildren) {
  const [value] = useState<SignInRequest>(() => {
    const answers: (() => void)[] = [];
    return {
      requestSignIn() {
        answers.at(-1)?.();
      },
      answerSignInRequests(answer) {
        answers.push(answer);
        return () => {
          const index = answers.lastIndexOf(answer);
          if (index >= 0) answers.splice(index, 1);
        };
      },
    };
  });
  return (
    <SignInRequestContext.Provider value={value}>
      {children}
    </SignInRequestContext.Provider>
  );
}
