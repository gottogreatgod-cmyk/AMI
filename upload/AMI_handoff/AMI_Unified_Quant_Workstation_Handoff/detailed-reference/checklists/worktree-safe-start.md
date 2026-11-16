# Worktree-safe start checklist

- [ ] Read root `AGENTS.md` and current source-of-truth index.
- [ ] Confirm branch and exact HEAD.
- [ ] Capture `git status --short --untracked-files=all`.
- [ ] Capture staged and unstaged diff statistics and changed paths.
- [ ] Inspect target files before edits; treat all modified/untracked files as owner work.
- [ ] Check disk/RAM; preserve at least the repository-mandated 2 GiB free disk.
- [ ] Confirm Windows-native execution constraints.
- [ ] Confirm no secrets will be read, copied, logged or packaged.
- [ ] Confirm the bounded work package, dependencies, files, tests and recovery plan.
- [ ] No reset/clean/stash/broad restore/delete/overwrite.
- [ ] No commit/push/deploy/provider spend/model-weight download/broker connection without separate authorization.
- [ ] Recheck complete status/diff after the slice and explain every changed path.
- [ ] Run focused tests, relevant regressions, typecheck/lint and `git diff --check` where appropriate.
- [ ] Update authoritative ledgers/evidence/handoff; do not mark ACCEPTED without owner review.
