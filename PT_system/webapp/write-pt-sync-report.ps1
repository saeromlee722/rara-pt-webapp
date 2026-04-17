$ErrorActionPreference = "Stop"

$Root = "C:\Users\saero\iCloudDrive\rara\rara"
$PtDataDir = Join-Path $Root "PT_data"
$ReportDir = Join-Path $Root "PT_system\webapp\sync_reports"
$JsonPath = Join-Path $ReportDir "pt-data-sync-report.json"
$MarkdownPath = Join-Path $ReportDir "pt-data-sync-report.md"

Set-Location $Root
New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null

$sourceRef = "origin/main"
git rev-parse --verify $sourceRef *> $null
if ($LASTEXITCODE -ne 0) {
  $sourceRef = "FETCH_HEAD"
}

$commit = (git rev-parse $sourceRef).Trim()
$commitShort = (git rev-parse --short $sourceRef).Trim()
$generatedAt = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

$remoteFiles = @(git -c core.quotePath=false ls-tree -r --name-only $sourceRef -- PT_data | Where-Object { $_ -like "*.md" })
$localFiles = @()
if (Test-Path $PtDataDir) {
  $localFiles = @(Get-ChildItem -LiteralPath $PtDataDir -Recurse -File -Filter "*.md" | ForEach-Object {
    $relative = $_.FullName.Substring($Root.Length + 1).Replace("\", "/")
    [PSCustomObject]@{
      path = $relative
      member = Split-Path $_.DirectoryName -Leaf
      file = $_.Name
      lastWriteTime = $_.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
    }
  })
}

$localPathSet = @{}
foreach ($item in $localFiles) {
  $localPathSet[$item.path] = $true
}

$missingInObsidian = @($remoteFiles | Where-Object { -not $localPathSet.ContainsKey($_) })
$recentFiles = @($localFiles | Sort-Object lastWriteTime -Descending | Select-Object -First 30)

$status = if ($missingInObsidian.Count -eq 0) { "sync_ok" } else { "sync_missing" }

$report = [PSCustomObject]@{
  generatedAt = $generatedAt
  status = $status
  sourceRef = $sourceRef
  commit = $commit
  commitShort = $commitShort
  remotePtNoteCount = $remoteFiles.Count
  localPtNoteCount = $localFiles.Count
  missingInObsidianCount = $missingInObsidian.Count
  missingInObsidian = $missingInObsidian
  recentFiles = $recentFiles
}

$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $JsonPath -Encoding UTF8

$lines = @()
$lines += "# PT_data Sync Report"
$lines += ""
$lines += "- Generated at: $generatedAt"
$lines += "- Status: $status"
$lines += "- Source ref: $sourceRef"
$lines += "- Source commit: $commitShort"
$lines += "- GitHub PT note count: $($remoteFiles.Count)"
$lines += "- Obsidian PT note count: $($localFiles.Count)"
$lines += "- Missing in Obsidian: $($missingInObsidian.Count)"
$lines += ""
$lines += "## Recent Obsidian Files"
foreach ($file in $recentFiles) {
  $lines += "- $($file.path) ($($file.lastWriteTime))"
}

if ($missingInObsidian.Count -gt 0) {
  $lines += ""
  $lines += "## Missing Files"
  foreach ($file in $missingInObsidian) {
    $lines += "- $file"
  }
}

$lines | Set-Content -LiteralPath $MarkdownPath -Encoding UTF8

Write-Host "PT_data sync report written: $JsonPath"
