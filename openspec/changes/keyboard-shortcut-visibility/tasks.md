## 1. Shared Presentation

- [x] 1.1 Add a shared shortcut hint component using the shortcut formatter
- [x] 1.2 Add hooks/selectors for resolving a command's primary display shortcut from the effective keymap
- [x] 1.3 Add presentation tests for assigned, unassigned, and sequence shortcut labels

## 2. Toolbar And Search

- [x] 2.1 Update toolbar tooltips to render shortcut hints next to tool titles
- [x] 2.2 Update dropdown variant rows to show shortcuts for variant commands
- [x] 2.3 Update tool search result rows to show shortcuts
- [x] 2.4 Add toolbar/search rendering tests

## 3. Context Menus

- [x] 3.1 Add optional `commandId` support to `WorkbenchContextMenuEntry`
- [x] 3.2 Render right-aligned shortcut hints for menu entries with assigned command shortcuts
- [x] 3.3 Assign command ids to existing high-value sidebar and timeline menu entries where commands already exist
- [x] 3.4 Add context menu rendering tests

## 4. Verification

- [x] 4.1 Run `bun run test`
- [x] 4.2 Run `bun run lint`
