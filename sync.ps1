#!/usr/bin/env pwsh
# ============================================================
# VCA Branch Sync Script
# Run from: d:\vehicle-claim-automation\vehicle-claim-automation
# Usage: .\sync.ps1
# ============================================================

param(
    [string]$CommitMessage = "chore: sync and update from origin/main",
    [switch]$PushOnly,
    [switch]$SyncFromMain,
    [switch]$StatusOnly
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

Set-Location $ProjectRoot

function Write-Step($msg) {
    Write-Host "`n==> $msg" -ForegroundColor Cyan
}
function Write-OK($msg) {
    Write-Host "    [OK] $msg" -ForegroundColor Green
}
function Write-Warn($msg) {
    Write-Host "    [WARN] $msg" -ForegroundColor Yellow
}
function Write-Fail($msg) {
    Write-Host "    [FAIL] $msg" -ForegroundColor Red
}

# ----------------------------------------------------------
# 1. STATUS CHECK
# ----------------------------------------------------------
Write-Step "Current Git Status"
git status
$branch = (git rev-parse --abbrev-ref HEAD).Trim()
Write-OK "On branch: $branch"

if ($StatusOnly) { exit 0 }

# ----------------------------------------------------------
# 2. SYNC FROM MAIN (pull latest main changes into feature branch)
# ----------------------------------------------------------
if ($SyncFromMain) {
    Write-Step "Fetching latest from origin..."
    git fetch origin

    Write-Step "Merging origin/main into $branch..."
    $conflictFiles = @()
    try {
        git merge origin/main --no-edit 2>&1 | ForEach-Object {
            if ($_ -match "CONFLICT") { $conflictFiles += $_ }
            Write-Host "    $_"
        }
        if ($conflictFiles.Count -gt 0) {
            Write-Fail "Merge conflicts detected in $($conflictFiles.Count) file(s):"
            $conflictFiles | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
            Write-Host "`n    Resolve conflicts manually, then run: .\sync.ps1" -ForegroundColor Yellow
            exit 1
        }
        Write-OK "Merged origin/main cleanly."
    } catch {
        Write-Fail "Merge failed: $_"
        exit 1
    }
}

# ----------------------------------------------------------
# 3. STAGE ALL CHANGES
# ----------------------------------------------------------
Write-Step "Staging all changes..."
git add -A
$staged = (git diff --cached --name-only)
if (-not $staged) {
    Write-Warn "Nothing to commit. Working tree is clean."
} else {
    Write-OK "Staged files:"
    $staged | ForEach-Object { Write-Host "    + $_" -ForegroundColor Gray }

    # ----------------------------------------------------------
    # 4. COMMIT
    # ----------------------------------------------------------
    if (-not $PushOnly) {
        Write-Step "Committing..."
        git commit -m $CommitMessage
        Write-OK "Committed: $CommitMessage"
    }
}

# ----------------------------------------------------------
# 5. PUSH TO ORIGIN
# ----------------------------------------------------------
Write-Step "Pushing branch $branch to origin..."
git push origin $branch
Write-OK "Pushed $branch to origin/$branch successfully."

# ----------------------------------------------------------
# 6. LOG (last 5 commits)
# ----------------------------------------------------------
Write-Step "Recent commit history:"
git log --oneline -5

Write-Host "`n[DONE] Branch is up to date and pushed." -ForegroundColor Green
