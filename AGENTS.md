# Working in this repository

## Reporting work: the same four-part shape every time

Every reply that reports finished work uses the same four sections, in this order, with these
headings. Predictability matters more than prose: the reader should be able to jump straight to
the part they want without reading the rest.

1. **Commit** — the short id and its subject, first line of the reply, on its own. Never buried
   mid-sentence or in a paragraph of explanation. If several commits went up, the last one first,
   and say whether `main` now matches it.
2. **What changed** — one line per change, in plain language: what someone using the app now
   sees or can do. No file names, function names, class names, CSS properties, selectors or diff
   excerpts unless the user asked about the code itself.
3. **Checks** — one line per check, pass or fail, and nothing else. No command output, no test
   counts unless one failed.
4. **Open** — only what is genuinely unresolved: unverified behaviour, an uncommitted file, a
   decision waiting on the user. Write `None.` when there is nothing.

### Keep out of the body

- The reasoning that led to the change. The user wants the outcome, not the trail.
- Mechanics that are invisible on screen: state variables, event handlers, layout properties,
  regressions you considered and rejected.
- Recaps of what was already reported in earlier turns.

If a detail matters, put it after the four sections under its own short note, or leave it out and
mention it only if asked. Length is not a virtue: a report over a screenful has not been edited.

### When there is no commit

Answering a question or looking something up still uses **Checks** and **Open**, and drops the
other two. Say plainly that nothing changed.

## Closing out: ranked suggestion chips

The chips are the last block of that same report — they come after **Open**, never inside or
before it, and never instead of it. They inherit the report's rules: plain language, one line
each, no file names or implementation detail, nothing the reader would have to decode.

Every piece of work ends with chips — the next things worth doing, ordered by importance. This is
the default for every turn, not something to wait to be asked for.

1. **Order by importance.** Largest user-visible payoff first: how many screens and sources a
   change touches, how visible the defect is, and whether it blocks something else. A cheap fix
   that removes a broken-looking page outranks an expensive one nobody will notice.
2. **Name the one to choose.** Exactly one chip is the recommended next step, with a sentence on
   what it fixes, who notices, and why it can wait no longer.
3. **Mark the rest optional.** Each optional chip gets one line: what it buys and why it is safe
   to leave.
4. **Be concrete.** A chip is an action that could be handed straight back ("drop datelines from
   feed bodies"), not a theme ("improve the reader").
5. **Keep it short.** One recommended chip plus two or three optional ones is usually right; a
   longer list means the options have not been judged.
6. **Say when there is nothing left.** If a turn made no substantive change — a question answered,
   an investigation that found nothing, a check that passed with no edits — say so plainly in
   **Open** and stop. Never invent chips to fill the space.

Each chip carries its reason. A ranking without a why is not a recommendation.

### Worked example

A finished report is just these blocks, in this order, with nothing added around them:

```
**Commit:** `a1b2c3d` — fix: stop the reader's footer clipping on phones

**What changed**
- The footer buttons hold one line on a narrow phone.
- The closing note no longer runs under the home bar.

**Checks**
- Pass — typecheck, tests, build.

**Open**
- Nothing committed yet; not looked at on a real phone.

**Next**
- **Commit the footer fix** — it's finished and uncommitted, so it could be lost in the next pull.
- *Optional:* test at 320px — cheap, but 360 is the narrowest common phone.
```
