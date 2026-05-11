import type { Page } from "@playwright/test";

export interface ActionableConsoleErrorRecord {
  type: string;
  text: string;
}

export function captureActionableErrorRecords(page: Page) {
  const records: ActionableConsoleErrorRecord[] = [];

  page.on("console", (message) => {
    const text = message.text();
    if (text.includes("[app-error]")) {
      records.push({
        type: message.type(),
        text,
      });
    }
  });

  return records;
}
