---
name: trial-post
description: Turn human-trial issues into short Discord testing threads that community testers can follow.
disable-model-invocation: true
---

# Trial post

Read [docs/community/discord.md](../../../docs/community/discord.md) first. Ask with the questionnaire tool whenever a step below asks for a choice.

1. **Pick trials.** If the user named issues, use those. Otherwise, list the open `human-trial` issues, drop the ones whose ID already appears in a `bun run discord list-trials` title, and ask which of the rest to post.
2. **Distil each trial.** A trial script is written for the developer, so it can have twenty steps and need local files. A tester gets at most **five** steps on https://cadara.app, each one an action followed by what they should see. Keep the steps that check what changed. Drop or move to one "Optional" line any steps that need special setup (screen readers, OS settings, two deploys). If the trial cannot work for an outside tester at all, tell the user instead of posting it.
3. **Draft** each thread in the format below and save it to `.scratch/community/trial-<id>.md`. Add `--attach` with a screenshot only if it makes a step clearer.
4. **Review.** Show every draft. Ask: post, change, or skip.
5. **Post** each approved one with `bun run discord post-trial <draft> --title "<short user-facing name> · <id>"`. Then comment on the issue: "Posted to Discord #testing: thread `<threadId>`".

## Thread format

```markdown
**What changed:** <one sentence in the voice from discord.md>

**Try it** on https://cadara.app (reload first to get the latest version):

1. <Do this.> → <You should see this.>
2. …

**Tell us:** <the trial's open question, for example "does it still feel stuck anywhere?"> Reply in this thread. Screenshots or a short clip help a lot.
```
