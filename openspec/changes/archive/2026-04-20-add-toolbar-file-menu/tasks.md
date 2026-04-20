## 1. Modeling Document Actions

- [x] 1.1 Add modeling service methods to export the current authored document, import an authored document, and restore the seeded new document.
- [x] 1.2 Add validation/error handling tests for document import, current-document export, and new document reset.

## 2. Toolbar Menu

- [x] 2.1 Add a far-left icon-only file menu to the toolbar with New, Import, and Export actions.
- [x] 2.2 Wire the workbench shell to download exported documents, open the file chooser for imports, refresh after document replacement, and show visible status messages.

## 3. End-to-End Coverage

- [x] 3.1 Add component coverage for the file menu rendering and callback wiring.
- [x] 3.2 Add Playwright coverage for exporting a `.cadara` document and importing it through the toolbar menu.

## 4. Verification

- [x] 4.1 Run `bun run test`.
- [x] 4.2 Run `bun run lint`.
- [x] 4.3 Run `bun run build`.
