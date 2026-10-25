import { useSaveActivityRing } from "@/hooks/use-save-activity-ring";

/**
 * cadara-781c: decorative save-activity ring around the spark logo; the save
 * state itself is announced by the page-leave notification (cadara-8p7o).
 * Rendered inside the logo button so it follows the logo's hover lift.
 * Styling: `.workbench-save-activity-ring` in index.css.
 */
export function SaveActivityRing({ saving }: { saving: boolean }) {
  const { phase, ringRef, rotorRef } = useSaveActivityRing(saving);
  return (
    <span
      ref={ringRef}
      aria-hidden="true"
      className="workbench-save-activity-ring"
      data-save-activity-ring={phase}
    >
      <span ref={rotorRef} className="workbench-save-activity-ring-rotor" />
    </span>
  );
}
