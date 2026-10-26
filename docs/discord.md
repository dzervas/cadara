# Discord community posting

Shared reference for the `changelog-post`, `trial-post` and `trial-harvest` skills.

## Discord CLI

`bun run discord --help` lists the commands. Every command prints JSON. Drafts and recordings go in `.scratch/community/` (gitignored). The bot posts into two channels:

- **changelog**: one post per update. Its last line is a GitHub compare link, `https://github.com/dzervas/cadara/compare/<old>...<new>`. The next run uses `<new>` as its starting point, so every post must end with it.
- **testing**: one thread per human trial. The thread title ends with the issue ID, which is the only link between the thread and the issue.

Discord rejects messages over 2000 characters, and the CLI refuses them before sending. Split a long post into two messages, with the attachment on the first.

## Voice

Readers are makers who use CADara, not people who build it. Lead each item with what they can now do or feel, in words they can test in the app: "Smoother splines while you edit a sketch", not "Fixed spline tessellation during preview". Engineering detail is welcome as a short, secondary _under the hood_ aside when it is interesting, because the project is open source and some readers are curious about the internals. Keep it friendly and brief, and skip the hype: one emoji per headline at most, no exclamation marks.

Every item links its commits: `[a1b2c3d](https://github.com/dzervas/cadara/commit/<full-sha>)`, with 7-character link text. When an item spans more than two commits, link the two most representative ones; the compare link covers the rest.

Users try things at https://cadara.app. The landing page opens three example models (Bracket, Wheel, Enclosure), which make good starting points for demos and trial steps.

### Example pairs

| Commit or issue                                                                                                                                | Post                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Fixed spline tessellation during preview                                                                                                       | Smoother splines while you edit a sketch                                                                               |
| Rename a body in place instead of re-running every OCC feature                                                                                 | Renaming a body is instant, even on big models. _Under the hood: renames no longer rebuild the whole feature history._ |
| Show measured feature rebuild progress while opening a document                                                                                | Opening a document shows real progress (`Rebuilding features 12/31 · Extrude 4`) instead of a frozen screen            |
| Migrate the service worker to Workbox with an update prompt and incremental precache                                                           | CADara tells you when a new version is ready, and updates download only what changed                                   |
| Resume history rebuilds from the last unchanged checkpoint; reuse the accepted mutation's export; keep unchanged meshes across light mutations | Folded into one line: edits on long feature histories feel snappier                                                    |
| Retire 7 more spec typecheck exclusions                                                                                                        | Left out: users see no difference                                                                                      |

When the user edits a draft, add the corrected pair to this table if it shows something the existing pairs do not.

## Issues

Commit subjects end with their issue reference: `(cadara-xxx)` for beads, `#123` for GitHub issues once the project moves there. Look issues up with whichever tracker the reference belongs to:

| Action                   | beads                                                                          | GitHub                                                |
| ------------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Read, including comments | `bd show <id> --json --include-comments`                                       | `gh issue view <n> --json title,body,labels,comments` |
| Comment                  | `bd comments add <id> "<text>"`                                                | `gh issue comment <n> --body "<text>"`                |
| Search before filing     | `bd list --all --json --limit 0`, then match the title and description with jq | `gh issue list --state all --search "<words>"`        |
| File                     | `bd create` following AGENTS.md                                                | `gh issue create`                                     |
| Human trials             | label `human-trial`; the title names the issue it verifies                     | label `human-trial`                                   |
