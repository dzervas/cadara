export interface DurableHistoryActionEntry {
  sequence: number;
  label: string;
}

export interface DurableHistoryAvailability {
  canUndo: boolean;
  canRedo: boolean;
  undoEntries?: readonly DurableHistoryActionEntry[];
  redoEntries?: readonly DurableHistoryActionEntry[];
}
