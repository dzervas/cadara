import type { WorkbenchIconName } from "@/components/ui/workbench-icon";

export interface DocumentFileMenuItem {
  id: DocumentFileMenuItemId;
  label: string;
  icon: WorkbenchIconName;
}

export type DocumentFileMenuItemId =
  | "new"
  | "openDocument"
  | "saveDocumentAs"
  | "about";
export type DocumentFileMenuCommand =
  | "newDocument"
  | "openDocument"
  | "saveDocumentAs"
  | "about";

export const DOCUMENT_FILE_MENU_ITEMS: readonly DocumentFileMenuItem[] = [
  {
    id: "new",
    label: "New",
    icon: "newDocument",
  },
  {
    id: "openDocument",
    label: "Open...",
    icon: "import",
  },
  {
    id: "saveDocumentAs",
    label: "Save As",
    icon: "download",
  },
  {
    id: "about",
    label: "About",
    icon: "info",
  },
];

export function getDocumentFileMenuCommand(
  itemId: DocumentFileMenuItemId,
): DocumentFileMenuCommand {
  switch (itemId) {
    case "new":
      return "newDocument";
    case "openDocument":
      return "openDocument";
    case "saveDocumentAs":
      return "saveDocumentAs";
    case "about":
      return "about";
  }
}
