---
description: sync naman-bt branch with latest origin/main changes
---

## Sync Branch with Main

Run these steps from `d:\vehicle-claim-automation\vehicle-claim-automation` (the inner git root).

### Step 1: Commit any unstaged local work
```powershell
git add -A
git commit -m "wip: save local work before sync"
```

### Step 2: Fetch and merge latest main
```powershell
git fetch origin
git merge origin/main --allow-unrelated-histories
```

### Step 3: If conflicts arise
Ask the AI agent to resolve them, or run:
```powershell
# Check which files have conflicts
git diff --name-only --diff-filter=U
```

### Step 4: After resolving conflicts, commit the merge
```powershell
git add -A
git commit -m "Merge origin/main into naman-bt: <describe what changed>"
```

### Step 5: Push to remote
```powershell
git push origin naman-bt
```

### One-liner using sync.ps1 (for future clean syncs)
```powershell
# Just push current committed changes:
.\sync.ps1 -CommitMessage "feat: your message here"

# Fetch + merge + push in one go:
.\sync.ps1 -SyncFromMain -CommitMessage "sync: pull latest main"

# Check status only:
.\sync.ps1 -StatusOnly
```
