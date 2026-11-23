# /lite-review [solo] — Quick adversarial review (≤4 min)

Run this after the last build task, or at T+43 no matter what. Default mode starts **3 reviewers in parallel in the background**, so the human can walk through the code on camera while they work. `solo` does a single inline pass covering all three lenses and spawns no subagents. Use it when behind schedule.

## Step 1 — Clock + evidence
Run `date`, then run these and keep the results: `npm test` (summary), the batch processing command from PLAN.md §6 (writes the output file), and `git ls-files`.

## Step 2 — Reviewers
Start all three in **one message** (Agent tool, `run_in_background: true`). Each gets: the paths to `docs/CHALLENGE.md`, `docs/PLAN.md`, the data-pack folder, the output file, and `src/`. Each reviewer is **read-only**: no edits and no git commands that change the working tree. Each returns **at most 5 findings**, each one `SEVERITY | file:line | problem | concrete failing input → wrong result | fix (1 line)`. Each has a 3-minute budget, and anything uncertain is reported as NOTE.

- **R1 — Spec & rules.** Check the business logic against the policy text and the spec: threshold boundaries, the right approver per tier and region, the backup chain (including a backup who is also out), low-confidence lines going to a specialist first, duplicate semantics (which draft is the original), and pricing source and formulas. **Recompute 2 drafts by hand** from the data pack and compare them with the output file. Check the output format exactly: keys, order, statuses enum, 2 decimals, `null` vs `[]`, and every draft present in input order.
- **R2 — Reliability & security.** Check that retry, timeout, and backoff are actually applied to the stock calls and tested. Check that the "exhausted retries" case gets flagged as unavailable, not blocked or guessed. Check that staleness is based on data timestamps, not wall-clock assumptions. Check that only the specialist or the routed approver can approve, that unknown users are rejected, and whether self-approval is possible. Check that every state change writes an audit row with before/after status. Check for double approval (a guarded transition). Check that there's no write path to the system of record and that external DBs are opened read-only. Check for secrets: `git ls-files | grep -iE '(^|/)\.env$'`, and grep `src/` and `config/` for key/token patterns.
- **R3 — Deliverables & quality.** Check that every deliverable path from CHALLENGE exists (or is scheduled for `/lite-ship`). Check that the tests cover every required case; name the test for each. Check `.env.example` (names only), that `.env` is ignored, and that `.chat-history/` is *not* ignored. Check that the How to Run commands actually work. Look for things that would embarrass on camera: `any`, `console.log`, dead code, hardcoded thresholds or people, and TODOs without a STUB note.

**Severity**
- `BLOCKER`: breaks an acceptance criterion, gives wrong output, crashes, or exposes a secret. Fix it now.
- `CHEAP`: a real issue that can be fixed in under 2 minutes. Fix it now if the clock allows.
- `NOTE`: worth saying out loud. Goes into the README (known limitation or "two more weeks").

## Step 3 — Aggregate → `docs/REVIEW.md`
```markdown
# Adversarial Review — T+MM
Verdict: PASS | FIX-THEN-PASS
| # | Sev | Lens | Where | Problem | Fix | Status |
```
Remove duplicates. **Check each BLOCKER yourself** (reproduce it or read the code) before acting, because reviewers can be wrong. Mark false positives `REJECTED: <reason>`.

## Step 4 — Fix
Fix the BLOCKERs, then the CHEAP ones while time allows. Each fix gets a test where it makes sense. Run `npm test`, `npm run build`, and `npm run lint`, then re-run the batch command. Commit with `review: <summary>`. NOTEs stay in REVIEW.md for `/lite-ship` to pick up.

## Step 5 — Report
Print the verdict, what got fixed, and ⏱. Add up to 3 talking points. "What the review caught and why it mattered" is a strong moment on camera.
