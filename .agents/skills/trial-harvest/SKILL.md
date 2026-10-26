---
name: trial-harvest
description: Collect tester replies from Discord trial threads, deduplicate them and file them to the right issues.
disable-model-invocation: true
---

# Trial harvest

Read [docs/discord.md](../../../docs/discord.md) first. Ask with the questionnaire tool whenever a step below asks for a choice.

A reply is **harvested** once the bot has added ✅ to it (`reactions` contains `{ "emoji": "✅", "mine": true }`). The ✅ is the only record of what has been filed, so add it exactly when the reply's content lands on an issue.

1. **Gather.** Run `bun run discord list-trials`. For each thread, run `read-thread <threadId>` and keep the replies that are not from the bot and not yet harvested. Download attachments while you are here, because Discord's attachment URLs expire, and look at them. The step is done when every thread has been read, including archived ones.
2. **Distil per thread.** Merge replies that report the same thing, and count how many testers each point has. Sort every point into one kind:
   - **confirmation**: it works as described.
   - **defect**: something broken, with steps to reproduce when the tester gave them.
   - **opinion**: wording, feel, layout.
   - **question**: a tester asking something.

   Rewrite each point in plain, specific words, and keep short quotes when the exact wording carries detail. Attribute testers by Discord name. Thanks, chatter and "+1" replies count toward a point or are dropped.

3. **Propose.** For every thread, show the user:
   - the comment for the trial's issue (point counts and kinds, plus descriptions of any screenshots), and
   - each defect that deserves its own issue. Search the tracker first, and propose a comment on an existing issue when one already covers it.

   Answer questions you can answer from the code or docs. Ask the user about the rest. The user approves, edits or drops each item.

4. **File.** Post the approved comments and create the approved issues. Then add ✅ to every reply the filing covered (`bun run discord react <threadId> <messageId> ✅`), dropped ones included, so they are not proposed again. In the thread, reply with a short thank-you that names any new issue and answers the approved questions.
5. **Report** what landed where, and which threads had nothing new.
