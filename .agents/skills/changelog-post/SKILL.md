---
name: changelog-post
description: Draft and post the Discord changelog for everything pushed to main since the last post, with an optional demo GIF.
disable-model-invocation: true
---

# Changelog post

Read [docs/community/discord.md](../../../docs/community/discord.md) first. It defines the channels, the voice and the issue lookups. The user is present for the whole run, so ask with the questionnaire tool whenever a step below asks for a choice.

1. **Find the range.** Run `bun run discord last-changelog`. Take `<old>` from the `<new>` side of its compare link. If there is no previous post, ask the user where to start (offer "last 7 days", "last 14 days", or a revision they type). The range is `<old>..main@origin`. If it is empty, tell the user and stop.
2. **Collect.** List the commits with `jj log --no-graph -r '<old>..main@origin' -T 'commit_id ++ "\t" ++ description ++ "\n"'`. Group them by issue reference. Merge sibling issues under one parent or epic when they serve one user-visible change. The step is done when every commit belongs to exactly one group.
3. **Understand each group.** Read the issue, any `human-trial` issue that names it, and `jj diff --stat` when the subject alone does not show what changed. A trial script describes the change as a user meets it, so it is the best raw material.
4. **Triage.** Sort every group into exactly one tier:
   - **headline**: a user can see or try it and it is worth a sentence. Three at most.
   - **one-liner**: noticeable, but small.
   - **folded**: performance work and fixes users only feel. Merge these into a few lines by theme, such as "big documents open faster".
   - **dropped**: tests, CI, tooling, refactors.

   CLI and SDK changes matter to people who script CADara, so give notable ones a short section of their own. Flag headlines whose human trial is still open or failed; the user decides whether to hold them back or to invite testers to the thread in #testing.

5. **Draft** in the post format below and save it to `.scratch/community/changelog-<date>.md`.
6. **Demo.** Offer the user up to three headline candidates that would look good animated, each with a one-line shot description, plus a "no demo" option. Record the chosen one following [demo-recording.md](demo-recording.md). When recording fails, show the user what went wrong and ask: retry, pick another candidate, or post without a demo.
7. **Review.** Show the full draft and the demo path. Ask: post, change (apply their edits and show it again), or cancel. When their edits show a new pattern, add a pair to the voice examples in `docs/community/discord.md`.
8. **Post** with `bun run discord post-changelog <draft> [--attach <demo>]`, and report the returned message ID.

## Post format

```markdown
## CADara update · <Month D>

<emoji> **<Headline>**
<One or two sentences on what to try. Optional _under the hood_ aside.> [a1b2c3d](…)

**Also new**

- <one-liner> [a1b2c3d](…)

**Smoother and faster**

- <folded theme> [a1b2c3d](…) [e4f5a6b](…)

Plus <N> fixes and internal improvements.
[All changes](https://github.com/dzervas/cadara/compare/<old>...<new>)
```

Leave out any empty section. `<new>` is the full commit ID of `main@origin`, and the compare link stays the last line.
