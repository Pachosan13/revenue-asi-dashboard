MANDATORY: Read /docs/system-truth.md (SOT) before doing anything.

- The file `docs/system-truth.md` is the Single Source of Truth (SOT) for repo behavior.
- Before doing any task: read `docs/system-truth.md` and align actions to it.
- If `docs/system-truth.md` conflicts with code, do not guess: reconcile by updating the SOT to match repo truth, or mark **UNRESOLVED**.

## Repo-truth contract (non-negotiable)

- If a claim is not provable from code/config in this repo, it is **UNRESOLVED**.
- Never invent endpoints, env vars, cron schedules, schema columns, or provider behaviors.
- Use exact file-path references (e.g., `supabase/functions/run-cadence/index.ts`). No fabricated citations.

## Execution-first priorities

- Prioritize live execution paths over UX/prompt polish:
  - dispatch reliability (dispatch-engine + dispatch-touch-*)
  - voice/sms/whatsapp delivery correctness
  - runtime truth correctness (views / status semantics)
  - scheduler/cron safety (UNRESOLVED if not in repo)
- Do not optimize UI or prompts while execution is broken.

## Change discipline

- Minimal diffs. No drive-by formatting.
- Do not change unrelated files. If you touch a file, explain why.
- If behavior changes, propose the SOT update first (or in the same PR) and keep it factual.
- If you change behavior, you MUST update SOT changelog in the same PR/commit set.
- Record confirmed changes in the SOT changelog:
  - If a changelog section does not exist, add a short `## Changelog` section and append one bullet per confirmed change.
- When unsure, ask for repo evidence (file path, logs, SQL output) OR mark **UNRESOLVED**.

## Workflow (deterministic)

1) Audit
   - Identify current behavior from repo code/config.
   - Use targeted searches (grep/rg) scoped to likely directories.
2) Patch
   - Make the smallest correct change.
   - Prefer additive guards and narrow conditionals over rewrites.
3) Validate
   - Provide exact commands to run (SQL, curl, supabase deploy).
   - Include expected outputs and failure modes.
4) Commit
   - Show `git status` before commit.
   - Commit small, scoped, and factual.

## Commit standards

- One change theme per commit where possible.
- Commit messages:
  - `fix:` for behavior changes
  - `feat:` for new capability
  - `chore:` for refactors/docs/tools with no behavior change
  - `debug:` for temporary diagnostics (must be safe: no secrets)
- Message content must be factual (what changed), not aspirational.

## High-risk guardrails (do not violate)

### Supabase DB migrations

- Never edit already-applied migrations. Add a new migration file instead.
- Do not invent schema columns. Verify with existing migrations or explicit SQL output.
- When changing constraints/views, use `create or replace` only if safe and versioned.

### Cron / scheduling

- Do not claim “runs every N minutes” unless there is repo-truth config proving it.
- If scheduling is configured outside the repo (dashboard/manual), label it **UNRESOLVED** and ask for evidence.

### Voice / carriers / providers

- Bill/record usage only for provider-accepted events (if billing exists).
- Do not mark actions as “sent” unless the provider actually initiated/accepted the request.
- Never log secrets (API keys, JWTs). If debugging auth, log only booleans, lengths, and hashes/prefixes.

## Missing context rule

If a task depends on unknowns:

- Ask for the exact repo evidence (file path, migration, function logs, SQL query output), OR
- Mark the claim **UNRESOLVED** and proceed only with provable changes.

## Output policy (default)

- Default output: patch/diff + exact commands + expected result. No essays.


