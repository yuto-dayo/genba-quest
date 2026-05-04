# DB Baseline Review / Runbook Template

Date: 2026-05-01
Owner: DB expert reviewer
Target operation: remote migration baseline review only
Remote history updated: yes

## 0. Current Run Status

2026-05-04 adoption preflight update:

- Project ref remains `ggnxplgngmcelkdqhgfx`.
- Local `supabase/migrations` now contains 3 files: baseline `20260501130150`, lint-fix `20260504000000`, and reward-run column drift fix `20260504054000`.
- `supabase migration list` succeeds and shows remote history empty with all 3 local versions missing remotely.
- `supabase db query --linked` read-only probes show `20260504000000` is not present remotely: `public.approve_proposal_atomic`, `public.assert_reward_write_allowed`, and `public.execute_proposal_atomic` do not have the fixed `search_path` or lint-cleanup effects.
- `supabase db query --linked` read-only probes show `20260504054000` is not present remotely: `public.reward_runs` has 0 of the 13 canonical output columns added by the migration.
- `supabase db query --linked` read-only probe shows `public.reward_runs` currently has 0 rows, so adding the canonical output columns with defaults does not backfill existing reward outputs.
- `npm run db:reset`: PASS locally with all 3 migrations.
- `npm run db:lint`: PASS locally with all 3 migrations.
- `npm run db:push:remote:dry`: currently blocked because `SUPABASE_DB_PASSWORD` is unset in the Codex environment.
- Recommended adoption sequence: repair only `20260501130150` as applied, then push `20260504000000` and `20260504054000` through Supabase CLI after explicit approval and password-backed dry-run.
- `supabase db push`: not run.
- `supabase migration repair`: not run.
- Remote history updated: no.

2026-05-04 execution result:

- Human approval: `baseline adoption 承認。repair と push を実行してよい`.
- `supabase migration repair 20260501130150 --status applied --linked`: PASS.
- `npm run db:push:remote:dry`: PASS after baseline repair; pending migrations were exactly `20260504000000` and `20260504054000`.
- `npm run db:push:remote`: PASS for `20260504000000` and `20260504054000`.
- Post-push function probe found lint cleanup applied, but `search_path` still unset because the string-based `pg_get_functiondef` replacement did not match remote formatting.
- Added `supabase/migrations/20260504070358_fix_security_definer_search_path_after_baseline_adoption.sql`, using `ALTER FUNCTION ... SET search_path TO public, pg_temp`.
- `npm run db:reset`: PASS with all 4 migrations.
- `npm run db:lint`: PASS locally with all 4 migrations.
- `npm run db:push:remote:dry`: PASS and showed only `20260504070358` pending.
- `npm run db:push:remote`: PASS for `20260504070358`.
- Remote `supabase_migrations.schema_migrations` now contains all 4 versions: `20260501130150`, `20260504000000`, `20260504054000`, `20260504070358`.
- Remote catalog probe confirms the 3 target SECURITY DEFINER functions now have `proconfig = [search_path=public, pg_temp]`.
- Remote catalog probe confirms `public.reward_runs` has all 13 canonical output columns and still has 0 rows.
- Final review found additional baseline SECURITY DEFINER functions with `NULL` or `search_path=public` only. Added `20260504071238_harden_remaining_security_definer_search_path.sql`.
- `npm run db:reset`: PASS with all 5 migrations.
- `npm run db:lint`: PASS locally with all 5 migrations.
- `npm run db:push:remote:dry`: PASS and showed only `20260504071238` pending.
- `npm run db:push:remote`: PASS for `20260504071238`.
- Final `npm run db:push:remote:dry`: PASS; `Remote database is up to date`.
- Remote `supabase_migrations.schema_migrations` now contains all 5 versions: `20260501130150`, `20260504000000`, `20260504054000`, `20260504070358`, `20260504071238`.
- Remote catalog probe confirms remaining insecure SECURITY DEFINER count is 0.
- `supabase migration list` and `supabase db lint --linked` still fail from this Codex shell because `SUPABASE_DB_PASSWORD` is not inherited; use a shell with valid `SUPABASE_DB_PASSWORD` if those exact commands are required.
- Remote history updated: yes.

2026-05-04 repo fixation verification attempt:

- `supabase --version`: PASS, `2.95.4`.
- `SUPABASE_DB_PASSWORD`: unset in the current Codex shell.
- `supabase migration list`: BLOCKED, `Cannot find project ref. Have you run supabase link?`
- `supabase db lint --linked --schema public,private --fail-on error`: BLOCKED, `Cannot find project ref. Have you run supabase link?`
- Interpretation: the repository now contains the canonical `supabase/config.toml` and 5 migration files, but the local ignored link state under `supabase/.temp/` is not present in this checkout and the password is not in the shell. Rerun both linked checks from a linked, password-backed shell before marking final remote DB verification complete.

2026-05-01 run status:

- Project ref: `ggnxplgngmcelkdqhgfx`
- Correct CLI project root: repository root (`/Users/yutoyoshino/Documents/genba-quest`), not `--workdir supabase`
- `supabase link --project-ref ggnxplgngmcelkdqhgfx`: succeeded from repo root
- `supabase migration list`: succeeded; remote migration history is empty
- `supabase db pull remote_baseline_20260430 --schema public,private`: failed before schema generation because `db.ggnxplgngmcelkdqhgfx.supabase.co` has no DNS answer
- `supabase db pull remote_baseline_20260430 --schema public,private --db-url <pooler-url-without-password>`: failed because remote Postgres password is required
- A password was provided once via hidden TTY stdin, then unset; pooler authentication still failed with `FATAL: password authentication failed for user "postgres"`. Do not preserve the attempted password in this repository.
- A later password reset value was also provided via hidden TTY stdin and unset. Session pooler `5432` and transaction pooler `6543` both returned `FATAL: password authentication failed for user "postgres"`.
- Testing the pooler with user `postgres` instead of `postgres.ggnxplgngmcelkdqhgfx` returned `ENOIDENTIFIER`, confirming the pooler username must include the project ref.
- Retrying direct linked pull with `--dns-resolver https` still returned no valid IP for `db.ggnxplgngmcelkdqhgfx.supabase.co`.
- Pooler pull with URL-encoded password in the connection URL succeeded. The generated file was `supabase/migrations/20260501130150_remote_baseline_20260430.sql`.
- The prompt `Update remote migration history table? [Y/n]` appeared and was answered `n`.
- The generated baseline included managed `realtime` / `storage` trigger fragments and `drop extension if exists "pg_net";`; these were removed because they are outside the `public,private` canonical baseline and broke local reset.
- `npm run db:reset`: PASS after removing managed schema fragments.
- `npm run db:lint`: initially failed on existing warnings in `public.execute_proposal_atomic`, `public.approve_proposal_atomic`, and `public.assert_reward_write_allowed`.
- `supabase/migrations/20260504000000_fix_baseline_function_lint.sql`: added local follow-up migration to remove the lint-only warnings and fix `search_path` on the touched SECURITY DEFINER functions.
- `npm run db:reset`: PASS with baseline + lint-fix migration.
- `npm run db:lint`: PASS after the lint-fix migration.
- `npm run db:types`: PASS.
- `npm run db:push:remote:dry`: PASS; baseline and lint-fix migrations are pending.
- Generated baseline migration file: `supabase/migrations/20260501130150_remote_baseline_20260430.sql`
- Remote history updated: no
- `supabase db push`: not run
- `supabase migration repair`: not run
- `supabase db reset --linked` / `supabase db reset --db-url`: not run

Next required human action: approve the baseline adoption execution plan and provide a valid `SUPABASE_DB_PASSWORD` in the execution environment. Do not paste the password into docs or chat.

## 1. Scope

This artifact is the review record for a proposed remote baseline operation. It is not an execution approval and it must not be treated as evidence that the remote migration history was changed.

Allowed outcome for this review:

- Identify the intended baseline migration file.
- Capture read-only or dry-run command output.
- Review the candidate baseline for database safety issues.
- Produce an adoption proposal for a human maintainer.

Disallowed during this review:

- `supabase db push`
- linked project reset or db-url reset
- `supabase migration repair` in this workflow
- destructive SQL against local or remote databases
- commands using `--yes`
- `yes | ...` pipes
- edits outside this document

## 2. Baseline Migration File Slot

Fill this section before asking for adoption.

| Field | Value |
| --- | --- |
| Baseline migration version | `<YYYYMMDDHHMMSS>` |
| Baseline migration version | `20260501130150` |
| Baseline migration file | `supabase/migrations/20260501130150_remote_baseline_20260430.sql` |
| Source inventory / review note | `docs/SQL_INVENTORY.md`, `docs/SQL_INVENTORY.generated.md` |
| Target environment | `remote project` |
| Target Supabase project ref | `ggnxplgngmcelkdqhgfx` |
| Reviewer | `codex` |
| Review started at | `2026-05-01` |
| Review completed at | `2026-05-01` |
| Remote history updated | `yes as of 2026-05-04 execution; no during original 2026-05-01 review` |

## 3. Prompt Handling Rules

These rules are mandatory for baseline rehearsal commands.

| Prompt text / condition | Required response |
| --- | --- |
| `Update remote migration history` during a `db pull` history prompt | Answer `n` and record output |
| Any other prompt | Stop immediately; do not answer |
| Command asks for confirmation with destructive wording | Stop immediately |
| Command proposes applying SQL, resetting link, repairing history, or pushing migrations | Stop immediately |
| Operator is unsure whether a prompt is safe | Stop immediately |

Never use `--yes` and never pipe `yes` into Supabase CLI commands for this workflow.

## 4. Exact Safe Command Log

Paste exact command output under each heading. Commands in this section are for evidence collection only. If any command prompts unexpectedly, follow the prompt handling rules above.

### 4.1 Local Context

```bash
pwd
git status --short
supabase --version
```

Result:

```text
<paste output>
```

### 4.2 Migration File Presence

```bash
ls -la supabase/migrations
test -f supabase/migrations/<YYYYMMDDHHMMSS>_baseline.sql
```

Result:

```text
<paste output>
```

### 4.3 Local Migration Inventory

```bash
find supabase/migrations -maxdepth 1 -type f -name '*.sql' | sort
```

Result:

```text
<paste output>
```

### 4.4 Remote History Inspection

Use only if the active Supabase link is already known to be correct. Do not run link reset or db-url reset.

```bash
supabase migration list
```

Result:

```text
<paste output>
```

### 4.5 DB Pull History Prompt Log

Use this section only when a separately authorized `db pull` review command reaches the history prompt. If the CLI asks `Update remote migration history`, answer `n` and record the output. If any other prompt appears, stop.

Prompt response:

```text
Update remote migration history: n
```

Result:

```text
<paste output>
```

Remote history updated: no

### 4.6 History Adoption Proposal Only

This workflow may identify that remote migration history adoption or repair is needed, but it must not run that operation. Record the proposal details here and hand off to a separate human-approved execution runbook.

| Field | Value |
| --- | --- |
| History adoption appears needed? | `<yes | no | unknown>` |
| Reason adoption may be needed | `<remote/local history mismatch summary>` |
| Candidate migration version | `<YYYYMMDDHHMMSS>` |
| Candidate status | `<applied | reverted | unknown>` |
| Required approver | `<name / role>` |
| Execution runbook required before action | `yes` |
| Command execution in this workflow | `do not run` |
| Remote history updated | `no` |

2026-05-04 proposal:

| Field | Value |
| --- | --- |
| History adoption appears needed? | `yes` |
| Reason adoption may be needed | `remote history is empty; baseline DDL came from remote, but follow-up migration effects are absent remotely` |
| Candidate migration version | `20260501130150` |
| Candidate status | `applied in remote schema, missing from remote history` |
| Follow-up migration version | `20260504000000` |
| Follow-up status | `not applied remotely; push after baseline repair; remote reward_runs row count is 0` |
| Follow-up migration version | `20260504054000` |
| Follow-up status | `not applied remotely; push after baseline repair` |
| Required approver | `human maintainer / DB owner` |
| Execution runbook required before action | `yes` |
| Command execution in this workflow | `do not run until explicit approval and valid DB password` |
| Remote history updated | `no` |

## 5. Inventory Status Count

Use this table to summarize the inventory state before adoption. Counts must come from the inventory source and command logs, not from memory.

| Status | Count | Evidence |
| --- | ---: | --- |
| Present in local `supabase/migrations` | `<n>` | `<command/log reference>` |
| Present in remote migration history | `<n>` | `<command/log reference>` |
| Local only | `<n>` | `<command/log reference>` |
| Remote only | `<n>` | `<command/log reference>` |
| Candidate baseline files | `<n>` | `<command/log reference>` |
| Requires human decision | `<n>` | `<command/log reference>` |

2026-05-04 pre-execution measured counts:

| Status | Count | Evidence |
| --- | ---: | --- |
| Present in local `supabase/migrations` | `3` | `supabase migration list` |
| Present in remote migration history | `0` | `supabase migration list`; `supabase_migrations` table absent in read-only query |
| Local only | `3` | `supabase migration list` |
| Remote only | `0` | `supabase migration list` |
| Candidate baseline files | `1` | `20260501130150_remote_baseline_20260430.sql` |
| Follow-up migrations to push | `2` | read-only probes for `20260504000000` and `20260504054000` absent on remote; `public.reward_runs` row count is 0 |
| Requires human decision | `1` | approve baseline history repair + follow-up push |

2026-05-04 post-execution measured counts:

| Status | Count | Evidence |
| --- | ---: | --- |
| Present in local `supabase/migrations` | `5` | `find supabase/migrations -maxdepth 1 -type f -name '*.sql'` |
| Present in remote migration history | `5` | `supabase db query --linked` against `supabase_migrations.schema_migrations` |
| Local only | `0` | `npm run db:push:remote:dry` => `Remote database is up to date` |
| Remote only | `0` | remote history versions match local migration versions |
| Candidate baseline files | `1` | `20260501130150_remote_baseline_20260430.sql` |
| Follow-up migrations pushed | `4` | `20260504000000`, `20260504054000`, `20260504070358`, `20260504071238` |
| Requires human decision | `0` | baseline adoption executed |

## 6. DB Expert Review Checklist

Mark every item before proposing adoption.

| Check | Status | Evidence / notes |
| --- | --- | --- |
| RLS does not use `auth.jwt() -> 'user_metadata'` or editable user metadata | `<PASS | FAIL | N/A>` | `<notes>` |
| Public tables have RLS enabled or a documented exception | `<PASS | FAIL | N/A>` | `<notes>` |
| Public tables have explicit org-scoped policies where client access is expected | `<PASS | FAIL | N/A>` | `<notes>` |
| `SECURITY DEFINER` functions have a fixed `search_path` | `<PASS | FAIL | N/A>` | `<notes>` |
| Public views do not use unsafe `SECURITY DEFINER`; prefer `security_invoker` where appropriate | `<PASS | FAIL | N/A>` | `<notes>` |
| No destructive SQL is introduced or hidden in the baseline | `<PASS | FAIL | N/A>` | `<notes>` |
| Proposal state changes remain proposal-centric and policy-bound | `<PASS | FAIL | N/A>` | `<notes>` |
| Ledger events / transactions / entries remain append-only and balanced | `<PASS | FAIL | N/A>` | `<notes>` |
| Closed-period accounting data cannot be mutated directly | `<PASS | FAIL | N/A>` | `<notes>` |
| `org_id` tenant boundary is preserved on every org-scoped table and query path | `<PASS | FAIL | N/A>` | `<notes>` |
| Local verification completed without remote mutation | `<PASS | FAIL | N/A>` | `<notes>` |
| `db pull` history prompt, if encountered, was answered `n` and output was recorded | `<PASS | FAIL | N/A>` | `<notes>` |
| History adoption / repair remains proposal-only and was not executed | `<PASS | FAIL | N/A>` | `<notes>` |

## 7. Local Verification Commands

Run local checks only. Do not connect to or mutate the remote database from this section.

```bash
rg -n "auth\\.jwt\\(\\).*user_metadata|NULLIF\\(auth\\.jwt\\(\\) -> 'user_metadata'" supabase/migrations server/sql
rg -n "SECURITY DEFINER" supabase/migrations server/sql
rg -n "ENABLE ROW LEVEL SECURITY|CREATE POLICY" supabase/migrations server/sql
rg -n "DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|ALTER TABLE .* DROP|UPDATE public\\.(proposals|ledger_events|ledger_transactions|ledger_entries)" supabase/migrations server/sql
git diff --check -- docs/DB_BASELINE_REVIEW.md
```

Result:

```text
<paste output>
```

## 8. Findings

| ID | Severity | Finding | Evidence | Required action |
| --- | --- | --- | --- | --- |
| `DB-BL-001` | `Resolved` | Baseline had `SECURITY DEFINER` functions without fixed `search_path`; remote catalog now reports insecure SECURITY DEFINER count 0. | `20260504070358`, `20260504071238`, remote `pg_proc` probe | Resolved by forward migrations; do not edit baseline dump. |
| `DB-BL-002` | `P1` | Many policies use broad `USING (true)` / `WITH CHECK (true)` for authenticated users, including proposal/ledger/accounting surfaces. | baseline policy scan | Review object-by-object against intended server-only access and org boundary. |
| `DB-BL-003` | `P2` | Baseline contains proposal/ledger direct mutations inside existing RPCs and one `DELETE FROM public.reward_calculation_snapshots`. | baseline destructive/proposal scan | Treat as current remote behavior; future changes must preserve Proposal/Ledger rules and use safe forward migrations. |
| `DB-BL-004` | `Resolved` | `npm run db:lint` failed on existing plpgsql warnings. | `public.execute_proposal_atomic`, `public.approve_proposal_atomic`, `public.assert_reward_write_allowed` | Resolved by `20260504000000_fix_baseline_function_lint.sql` and pushed. |
| `DB-BL-005` | `Resolved` | Remote migration history was empty while local migrations existed. | remote `supabase_migrations.schema_migrations` now has all 5 versions | Resolved by baseline repair and follow-up pushes. |

## 9. Adoption Proposal

This section is the only place to recommend whether the baseline should be adopted. Adoption still requires explicit human approval and a separate execution runbook.

| Field | Recommendation |
| --- | --- |
| Adopt baseline? | `<yes | no | defer>` |
| Reason | `<summary>` |
| Required preconditions | `<backup, maintainer, project ref confirmation, no open P0/P1 findings>` |
| Exact execution owner | `<human name>` |
| Exact target environment | `<stg | prod | other>` |
| Exact baseline version | `<YYYYMMDDHHMMSS>` |
| History adoption / repair requirement | `<none | separate execution runbook required>` |
| Required prompt response in this review | `Update remote migration history during db pull => n` |
| Rollback / recovery note | `<PITR/snapshot or forward-fix plan>` |
| Post-execution verification | `<migration list, app smoke, RLS lint, proposal/ledger checks>` |

Adoption decision:

```text
<approved by / rejected by / deferred by, timestamp, notes>
```
