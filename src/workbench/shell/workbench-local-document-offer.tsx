import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Account } from "@/contracts/account/account";
import type { LocalDocumentOffers } from "@/application/account/local-document-offers";
import { LocalDocumentAccountBar } from "@/components/layout/local-document-account-bar";
import {
  selectEditorIdle,
  useEditorStateSelector,
} from "@/hooks/editor-state-store";
import { useModelingService } from "@/hooks/use-modeling-service";
import { useSignInRequest } from "@/hooks/sign-in-request-context";

export function WorkbenchLocalDocumentOffer({
  offers,
  slot,
  held,
  local,
  account,
  accountChecked,
  offline,
  onMove,
}: {
  offers: LocalDocumentOffers;
  slot: HTMLElement;
  /** Hidden like during a tool, e.g. while the Variables panel is under it. */
  held: boolean;
  local: boolean;
  account: Account | null;
  accountChecked: boolean;
  offline: boolean;
  onMove(): void;
}) {
  const modelingService = useModelingService();
  const documentId = modelingService.currentDocumentId;
  const editorIdle = useEditorStateSelector(selectEditorIdle);
  const { requestSignIn } = useSignInRequest();
  const offered = useSyncExternalStore(offers.subscribe, () =>
    offers.isOffered(documentId),
  );
  const previousAccount = useRef<string | null | undefined>(undefined);
  const [pointerHeld, setPointerHeld] = useState(false);
  useEffect(() => {
    // Only an answered check counts: an account that appears after a failed
    // one is the existing session recovering, not a new sign-in.
    if (!accountChecked || offline) return;
    const previous = previousAccount.current;
    previousAccount.current = account?.user.id ?? null;
    if (local && previous === null && account) offers.offer(documentId);
  }, [account, accountChecked, documentId, local, offers, offline]);
  useEffect(() => {
    if (!local) return;
    return modelingService.subscribeToDocumentChanges((event) =>
      offers.recordChange(event.documentId, event.metadata.source),
    );
  }, [local, modelingService, offers]);
  useEffect(() => {
    const pointers = new Set<number>();
    const down = (event: PointerEvent) => {
      if (!(event.target instanceof HTMLCanvasElement)) return;
      pointers.add(event.pointerId);
      setPointerHeld(true);
    };
    const up = (event: PointerEvent) => {
      pointers.delete(event.pointerId);
      if (!pointers.size) setPointerHeld(false);
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", up, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", up, true);
    };
  }, []);
  // A held canvas pointer only keeps the offer from appearing: once shown it
  // stays through clicks and orbits. An active tool or an open Variables
  // panel hides it until it ends.
  const [shown, setShown] = useState(false);
  const visible =
    local && offered && editorIdle && !held && (shown || !pointerHeld);
  if (visible !== shown) setShown(visible);
  return (
    <LocalDocumentAccountBar
      slot={slot}
      visible={visible}
      onMove={() => {
        if (account) onMove();
        else requestSignIn();
      }}
      onDismiss={() => offers.dismiss(documentId)}
      onDontAsk={() => offers.dontAsk(documentId)}
    />
  );
}
