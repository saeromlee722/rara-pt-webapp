Set-Location "C:\Users\saero\iCloudDrive\rara\rara"

# PT_data만 GitHub 최신 상태로 동기화
# .obsidian / .smart-env 같은 로컬 변경은 건드리지 않음

git fetch origin main
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

git restore --source origin/main --staged --worktree -- PT_data
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# GitHub 기준으로 PT_data를 완전히 맞춘다.
# 추적되지 않은 로컬 노트/폴더도 PT_data 범위 안에서는 정리한다.
git clean -fd -- PT_data
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host "PT_data sync complete: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

$reportScript = Join-Path $PSScriptRoot "write-pt-sync-report.ps1"
if (Test-Path $reportScript) {
  try {
    & $reportScript
  } catch {
    Write-Warning "PT_data sync report failed: $($_.Exception.Message)"
  }
}
