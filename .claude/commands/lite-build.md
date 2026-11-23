# /lite-build [next | T<n> | all] — Implement plan tasks

Default: `next`, the first unchecked task. `all` runs every remaining task in order, committing after each, and pauses only on a blocker or a budget overrun. `T<n>` runs that one task.

## Preconditions

- `docs/PLAN.md` exists. If its status isn't `APPROVED`, running this command counts as approval: set `Status: APPROVED (<time>)`.
- The scaffold is done (`package.json` and `node_modules/` exist). If the background install is still running, wait for it.

## Per-task loop

1. **Clock.** Run `date` and print `⏱ T+MM / 60 — T<n> budget <m> min`.
2. **Load.** Read the task line in PLAN.md, plus §3 Decisions and §5 Domain. Re-read the CHALLENGE section the task implements. Re-read the policy or spec file from the data pack if the task touches rules.
3. **Implement** following the architecture in `CLAUDE.md`:
   - Pure rules first (`*.rules.ts`), then the service, then the controller and module wiring.
   - Values from policy go in `config/*.json`, never in code. Put a comment quoting the policy line next to each rule.
   - Stubs get `// STUB: … — prod: …` and a row in the PLAN.md Stubs table.
4. **Test.**
   - Write the tests named in the task. Use table-driven `it.each` for rules, and name tests after the behavior (`routes 22% discount to regional manager`).
   - Run `npx jest <task spec files>`, then `npm test`, `npm run build`, and `npm run lint`.
   - Make at most 2 fix attempts. If it still fails, **stop**: show the failing test, the exact error, and your hypothesis.
5. **Self-check (≤30 s, mini-adversarial).** Re-read your diff (`git diff`) against the task's _done when_. Look for: a hardcoded value that belongs in config, an unhandled null or unavailable path, a state change without an audit row, a boundary (`>` vs `≥`) that doesn't match the policy text, and an output field name that doesn't match the spec exactly. Fix anything you find before going on.
6. **Record.** Tick the task in PLAN.md as `- [x] T3 (8) … — done T+24, 9 tests`. Fill in the Evidence column of §8. Add any new `D<n>` decisions.
7. **Commit.** `git add -A && git commit -m "T<n>: <goal>"`. Check that `.env` isn't staged first. If there's no git repo yet, run `git init` first.
8. **Report** in 3 lines or fewer: what was built, the test count, and ⏱. Add up to 3 **Talking points** with `file:line` for the key logic and the trade-off to say out loud.
   If the cumulative time is past the plan, propose a specific cut (which task to stub or shrink) and, under `all`, wait for the human's answer.

## After the last task

Create bruno collection for created endpoints, with test scenarios, under bruno-workspace, using Yaml format
Print `All tasks done — T+MM`. Suggest running `/lite-review` now, while the human walks through the code on camera (Part 2).
