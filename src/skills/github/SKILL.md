---
name: github
description: Interact with GitHub using the gh CLI — issues, PRs, CI runs, and API queries.
---

# GitHub Skill

Use the `gh` CLI to interact with GitHub. Always specify `--repo owner/repo` when not in a git directory.

## Pull Requests

Check CI status on a PR:
```bash
gh pr checks 55 --repo owner/repo
```

List recent workflow runs:
```bash
gh run list --repo owner/repo --limit 10
```

View a run and see which steps failed:
```bash
gh run view <run-id> --repo owner/repo --log-failed
```

Create a PR:
```bash
gh pr create --title "Fix bug" --body "Description here"
```

## Issues

List open issues:
```bash
gh issue list --repo owner/repo
```

Create an issue:
```bash
gh issue create --title "Bug report" --body "Steps to reproduce..."
```

## API for Advanced Queries

Get PR with specific fields:
```bash
gh api repos/owner/repo/pulls/55 --jq '.title, .state, .user.login'
```

## JSON Output

Most commands support `--json` for structured output. Use `--jq` to filter:
```bash
gh issue list --repo owner/repo --json number,title --jq '.[] | "\(.number): \(.title)"'
```

## Git Guidelines

- Always check `git status` before making changes
- Prefer creating new commits over amending
- Never force push without explicit user permission
- Use meaningful commit messages
