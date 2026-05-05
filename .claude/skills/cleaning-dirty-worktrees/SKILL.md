---
name: cleaning-dirty-worktrees
description: Use this skill in GENBA QUEST when the user asks to clean, fix, rescue, snapshot, or organize a dirty git worktree, including phrases like "dirty worktreeをどうにかして", "ワークツリーをクリーンにして", "片付けて", or "clean it". Preserves unknown user/agent work before returning the current branch to a clean state.
---

# Cleaning Dirty Worktrees

Use this skill to turn an unsafe dirty worktree into a recoverable state. The default goal is not to delete changes. The default goal is to preserve every unknown change, then make the requested working branch clean.

## Hard Rules

- Treat every existing dirty file as user or other-agent work until proven otherwise.
- Do not use `git reset --hard`, `git checkout -- .`, `git clean -fd`, or broad deletes unless the user explicitly asked for destructive cleanup.
- Prefer a recoverable snapshot branch over stash for large or mixed worktrees.
- Never push snapshot branches unless the user explicitly asks.
- Do not commit `.session/active_session`; `.session/` is local runtime state.
- If a snapshot includes questionable deletions or generated files, describe it as an unreviewed recovery snapshot, not feature work.

## Required Repo Protocol

Before implementation, read the top of the design philosophy:

```bash
sed -n '1,120p' docs/DESIGN_PHILOSOPHY.md
```

For GENBA QUEST, keep handoff protocol valid:

```bash
scripts/session/session-start.sh --agent codex --domain repo/worktree-cleanup --keep-handoff
```

If `.session/active_session` is stale, use:

```bash
scripts/session/session-start.sh --agent codex --domain repo/worktree-cleanup --keep-handoff --force-restart
```

Record decisions with `scripts/session/session-update.sh`. End with `scripts/session/session-end.sh` when feasible.

## Investigation

Start with read-only inspection:

```bash
git branch --show-current
git status --short --branch
git diff --stat
git diff --name-status
git ls-files --others --exclude-standard
git diff --cached --name-status
```

Classify changes into:

- tracked modifications
- tracked deletions
- untracked source files
- generated files
- local tool state, such as `.session/`, Supabase `.temp`, caches, or logs
- handoff/session files

Call out risky tracked deletions and large untracked directories before cleanup.

## Default Cleanup Flow

Use this flow when the user says "clean it" and has not requested destructive deletion.

1. Capture the starting branch and status.

```bash
start_branch="$(git branch --show-current)"
git status --short > /tmp/genba-worktree-status-before.txt
```

2. Create a snapshot branch.

```bash
snapshot_branch="codex/dirty-worktree-snapshot-$(date +%Y%m%d-%H%M%S)"
git switch -c "$snapshot_branch"
```

3. Stage and commit all current changes.

```bash
git add -A
git status --short
git commit -m "wip: snapshot dirty worktree before cleanup"
```

If pre-commit blocks because handoff is missing, do not bypass the guard. Start or update the session handoff, then retry the commit.

4. Verify the snapshot branch is clean.

```bash
git status --porcelain=v1
git rev-parse --short HEAD
```

5. Return to the starting branch.

```bash
git switch "$start_branch"
```

6. Remove only leftovers that are already preserved or clearly local runtime state.

For tracked leftovers, use targeted restore only after confirming the snapshot contains them:

```bash
git ls-tree -r --name-only "$snapshot_branch" -- <path>
git restore <path>
```

For untracked leftovers, first back them up or confirm they exist in the snapshot:

```bash
backup="/tmp/genba-worktree-leftovers-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup"
cp -a <path> "$backup"/
rm -rf <path>
```

Use exact paths. Do not run broad `git clean`.

7. Verify the requested branch is clean.

```bash
git status --porcelain=v1
git branch --show-current
git log --oneline --decorate -1
git log --oneline --decorate "$start_branch..$snapshot_branch"
```

## Small Dirty Worktrees

If the worktree has only a few obvious files and the user wants organization rather than a clean branch, prefer one of:

- commit the coherent finished change with matching handoff docs
- create a small `codex/wip-...` branch
- stash with `git stash push -u -m "<specific message>"` only when a branch commit would be excessive

Avoid stash for large mixed worktrees because it is easier to lose context.

## Final Response

Report:

- final branch and whether `git status --porcelain` is empty
- snapshot branch name
- snapshot commit hash or hashes
- any `/tmp` backups created
- any tests or session-end gates run
- any skipped validation or residual risk

Keep the response concise. Include recovery commands:

```bash
git switch <snapshot-branch>
git checkout <snapshot-branch> -- <path>
```
