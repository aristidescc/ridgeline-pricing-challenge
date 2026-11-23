# /lite-plan — Kickoff: read spec + data, scaffold, write the lite plan

Budget: **5 min** (the human narrates Part 1 in ≤3 min while you work). Arguments (optional): free-text notes from the human, which become constraints.

If the human answers a presented plan with `go` (or `approved`), set `Status: APPROVED (<time>)` in `docs/PLAN.md` and tell them to run `/lite-build all` (or `next`). If they reply with edits, apply them, show only what changed, and ask again.

---

## Step 0 — Clock
Run `date`. If `docs/PLAN.md` exists, keep its `Started:` (this is a re-plan). Otherwise `Started:` is now.

## Step 1 — Read everything (run the reads in parallel)
- `docs/CHALLENGE.md` (whole file).
- Find the data pack: `find . -name 'draft_quotes.json' -not -path '*/node_modules/*'`. If it's missing, stop and ask where it is.
- Read every data-pack file:
  - `.md`, `.json`, `.txt`: read in full.
  - SQLite: `sqlite3 <db> .schema`, then `SELECT COUNT(*)` and 3 sample rows per table, plus any metadata/snapshot timestamp table.
  - CSV: `head -5` and `wc -l`.
  - Mock server or fixtures: how to start it, its port, and how to force a failure or slowness.
- Don't re-run `ai_logging_prompt.txt`. Just confirm the logging is active (`.chat-history/log.md` exists or will be created).

## Step 2 — Scaffold (in the background, only if there's no `package.json`)
Run this as one background Bash command while you analyze:
```bash
npx -y @nestjs/cli new app --directory .scaffold --package-manager npm --skip-git --skip-install --strict \
 && rsync -a --ignore-existing .scaffold/ ./ && rm -rf .scaffold \
 && npm install && npm i @nestjs/config class-validator class-transformer better-sqlite3 \
 && npm i -D @types/better-sqlite3 supertest @types/supertest
```
Then make sure `.gitignore` contains `.env`, `*.db` for the app store (not the data pack), `dist/`, and `node_modules/`. It must **not** ignore `.chat-history/` or `outputs/`. Create `.env.example` (names only) and `config/`.

## Step 3 — Analyze the data (where judgment shows)
For each item, write a finding and a decision:
- **Policy parsing**: the exact thresholds and whether boundaries are `>` or `≥`, tiers and who approves, backup rules (what if the backup is also out?), the low-confidence threshold, and the dates the out-of-office rules use.
- **Drafts**: low-confidence lines, duplicate candidates (and the matching key), unknown SKUs or customers, missing contract prices, quantity/UoM oddities, and drafts that sit right at a threshold.
- **Freshness**: where "as of" timestamps come from (reporting snapshot, stock API response), and the staleness limits.
- **Formulas**: `net_total`, `effective_discount_pct` (relative to what list/base?), and rounding.
- **Determinism**: the processing "as-of" time used to evaluate out-of-office dates and staleness.

Name the **one decision that matters most** as `D1`.

## Step 4 — Write `docs/PLAN.md` (≤150 lines, lists over prose)

```markdown
# Plan — <solution name>
Started: <ISO time> · Budget: 60 min · Status: DRAFT

## 1. Problem
<3 lines: who, the pain, what we build>

## 2. Scope
**Build:** <bullets>
**Stub (what · why · production version):**
| Stub | Why | Production |
**Out of scope:** <bullets>

## 3. Decisions
- D1 (matters most): <decision> — <why> — <trade-off>
- D2 …

## 4. Data findings
- <finding> → <decision ref>

## 5. Domain
Entities: <name: key fields>
Statuses + transitions: <state machine, one line each; who can trigger it>
Rules (pure functions): <name(input) → output>

## 6. Module map
| Module | Responsibility | Key files |
Config files: <config/*.json and what they hold>
Entry points: HTTP `npm run start:dev` · batch `npm run process` · tests `npm test`

## 7. Tasks
- [ ] T1 (<min>) <goal> — files: … — tests: … — done when: …
- [ ] T2 …
(5–7 tasks totaling ≤38 min. Pure rules and their tests come before wiring. Reliability items get their own task. The last task produces the output file.)

## 8. Acceptance checklist
| Criterion (from CHALLENGE) | Task | Evidence (test name / file / command) |

## 9. Part 1 talking points
- What we build · What we stub and why · D1 · How we'll prove it works
```

Ordering for tasks: T1 config + reference data + pure pricing; T2 pure routing rules + tier, backup, and low-confidence tests; T3 stock client + retry + staleness; T4 persistence + audit + duplicate detection; T5 review/approve API + roles + edit stub; T6 batch processor → output file + e2e smoke. Adjust to the spec.

## Step 5 — Present and stop
Print this in the terminal: the Build / Stub table, D1, the task list with minutes, and the Part 1 talking points. Then ask: **"Approve the plan? Reply `go` or send edits."** **STOP.** Don't write source code before approval. The scaffold can finish in the background.
