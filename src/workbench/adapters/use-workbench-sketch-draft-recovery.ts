import { useEffect, useSyncExternalStore } from "react";
import type { SketchDraftRecoveryController } from "@/application/sketch-draft-recovery/controller";

const noSubscribe = () => () => {};
const noOffer = () => null;

export function useWorkbenchSketchDraftRecovery(
  recovery: SketchDraftRecoveryController | undefined,
  reportFailure: (source: string, message: string, error: unknown) => void,
) {
  const offer = useSyncExternalStore(recovery?.subscribe ?? noSubscribe, recovery?.getOffer ?? noOffer, noOffer);
  useEffect(() => {
    if (!recovery) return;
    const report = (error: unknown) => reportFailure("workbench.sketchDraftRecovery", "Sketch draft recovery could not be saved or loaded.", error);
    const guardedFlush = () => { try { recovery.flush(); } catch (error) { report(error); } };
    const visibility = () => { if (document.visibilityState === "hidden") guardedFlush(); };
    const disconnect = recovery.connect(report);
    const timer = window.setInterval(() => { try { recovery.tick(); } catch (error) { report(error); } }, 1_000);
    window.addEventListener("pagehide", guardedFlush);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clearInterval(timer);
      window.removeEventListener("pagehide", guardedFlush);
      document.removeEventListener("visibilitychange", visibility);
      disconnect();
    };
  }, [recovery, reportFailure]);
  const run = (action: () => void) => {
    try { action(); } catch (error) {
      reportFailure("workbench.sketchDraftRecovery", "Sketch draft recovery failed.", error);
    }
  };
  return offer && recovery ? { draft: offer, onResume: () => run(() => recovery.resume()), onDiscard: () => run(() => recovery.discard()) } : null;
}
