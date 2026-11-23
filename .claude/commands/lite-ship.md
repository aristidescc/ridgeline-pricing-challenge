# /lite-ship [docs | demo | submit] — Outputs, README, demo script, submission

With no argument, this runs all three in order: `docs` → `demo` → `submit`. Budget: docs 5 min, demo prep 1 min, submit 3 min.

---

## docs

1. **Clock.** Run `date`.
2. **Regenerate outputs from a clean state.** Delete the local app store (the `*.db` named in PLAN.md, never the data pack), then run the batch command. Validate the file with a `node -e` script. Check: it parses; it has one object per input draft, in input order; the keys exactly match the spec's example; each `status` is one of the spec's values; numbers have at most 2 decimals; and `duplicate_of` / `approver_id` are `null` when they don't apply. Print a compact table: `draft_id | status | net_total | disc% | approver | #flags | duplicate_of`.
3. **Write `README.md`** using the **exact headings and order from CHALLENGE.md** (Deliverable 3). Nothing goes before the first heading. No extra `#`/`##` headings; use `###` or bold inside sections if needed.
   - *Repository*: the result of `git remote get-url origin`, converted to an https URL. If there's no remote, write `TODO: public GitHub URL` and flag it in the report.
   - *How to Run*: copy-pasteable commands to install, start the service (plus the mock stock API if there is one), process the sample drafts, and run the tests. Include `cp .env.example .env`.
   - *Approach*: how pricing, stock, and routing work; where the rules live (`config/…`); the Stubs table from PLAN.md; and **D1 stated plainly**.
   - *Reliability*: retries (attempts/timeout/backoff values), stale vs unavailable data and how each shows in the output, duplicates (the matching key), roles (header-based prototype → production SSO/JWT), and double-approval protection.
   - *Production*: a Mermaid diagram (`flowchart LR`). Show the source systems as read-only, the service, its DB, rules/config storage, identity provider, approver channel, monitoring, and the customer-send step **only after approval**. Draw no arrow into the system of record. Then 2–4 short bullets for each Part 4 point: deploy and connect; monitor (including draft→approval time); change rules without a release; two more weeks (pull in the NOTEs from `docs/REVIEW.md`).
   - Check the headings: `grep -n '^#' README.md` must match the required list exactly.
4. Make sure `.env.example` lists every `process.env`/config key that's read (`grep -rn "get<\|process.env" src`), with names only.
5. Commit: `docs: README, outputs`.

## demo

Print a **5-minute demo script** to the terminal (don't save it as a file), using real IDs from the output:
1. Start the service (and mock), then run the batch processor. Show the summary table.
2. Point to specific drafts: one or two `specialist_only`, one routed to a manager, one to the VP, one with a **backup approver** applied, one `duplicate`, and one with low-confidence or stock flags.
3. Failure demo: show how to make the stock API fail (stop the mock or point the env var at a dead port), re-run, and show the retries in the logs and the `stock unavailable` flag.
4. Ready-to-paste `curl` commands: list quotes as the specialist; approve as the **wrong user** → 403; approve as the specialist, then as the routed approver → 200; try a second approval → 409; show the audit entries for that quote.
5. Closing line: D1 in one sentence. Then `npm test` with the tier, backup, and duplicate tests visible.

## submit

1. Check that every deliverable path exists, then run `npm test` (green) and `npm run build`.
2. Run `git ls-files | grep -iE '(^|/)\.env$'`. The result must be empty.
3. Commit any remaining changes. **Ask the human before `git push`**, showing the remote URL.
4. Zip, using the archive name from CHALLENGE.md:
   ```bash
   zip -rq ../<name>.zip . -x 'node_modules/*' 'dist/*' '.env' '*.db' '.scaffold/*'
   unzip -l ../<name>.zip | grep -E '(^|/)\.env$' && echo "ABORT: .env in zip"
   unzip -l ../<name>.zip | grep -E 'README.md|\.chat-history/|outputs/'
   ```
5. Print a final checklist with ✅/❌ for each deliverable, and the elapsed time. The zip goes in the submission form along with the MP4 link.
