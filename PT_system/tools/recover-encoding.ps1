param(
  [string]$Root = "PT_data"
)

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$cp949 = [System.Text.Encoding]::GetEncoding(949)

function Get-Score([string]$s) {
  if ($null -eq $s) { return -999999 }
  $hangul = [regex]::Matches($s, '[\uAC00-\uD7A3]').Count
  $han = [regex]::Matches($s, '[\u4E00-\u9FFF]').Count
  $replacement = [regex]::Matches($s, '�').Count
  $qmark = [regex]::Matches($s, '\?').Count
  return ($hangul * 4) - ($han * 2) - ($replacement * 4) - $qmark
}

$literalBacktickN = ([char]96).ToString() + 'n'
$files = Get-ChildItem -Path $Root -Recurse -File -Filter '*.md'
$changed = 0

foreach ($f in $files) {
  $path = $f.FullName
  $raw = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)

  $candidates = @()
  $candidates += [pscustomobject]@{ Name='raw'; Text=$raw; Score=(Get-Score $raw) }

  try {
    $fix1 = [System.Text.Encoding]::UTF8.GetString($cp949.GetBytes($raw))
    $candidates += [pscustomobject]@{ Name='cp949_to_utf8'; Text=$fix1; Score=(Get-Score $fix1) }
  } catch {}

  $best = $candidates | Sort-Object Score -Descending | Select-Object -First 1
  $output = $best.Text

  if ($output.Contains($literalBacktickN)) {
    $output = $output.Replace($literalBacktickN + $literalBacktickN, "`r`n`r`n")
    $output = $output.Replace($literalBacktickN, "`r`n")
  }

  if ($output -ne $raw) {
    [System.IO.File]::WriteAllText($path, $output, $utf8NoBom)
    $changed++
  }
}

"files=$($files.Count) changed=$changed"
