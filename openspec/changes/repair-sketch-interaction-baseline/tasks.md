## 1. Toolbar Visibility

- [ ] 1.1 Identify why sketch-mode toolbar icons render too dark against the shell.
- [ ] 1.2 Update shared toolbar icon/button styling so inactive, active, dropdown, and search-result tool icons remain visible.
- [ ] 1.3 Add or update toolbar presentation tests covering sketch-mode icon visibility classes or styles.

## 2. Constraint Selection Routing

- [ ] 2.1 Update viewport click routing so registered sketch constraint tools can dispatch valid picked targets while active.
- [ ] 2.2 Preserve drawing-tool pointer-release behavior for geometry creation tools.
- [ ] 2.3 Add or update editor/viewport tests showing hover and click both reach an active constraint authoring session.

## 3. Verification

- [ ] 3.1 Run `bun run test`.
- [ ] 3.2 Run `bun run lint`.
