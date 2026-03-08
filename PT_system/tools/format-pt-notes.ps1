param(
    [string]$Root = "PT_data"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-LineType {
    param([string]$Line)

    if ($Line -match '^\s*$') { return 'empty' }
    if ($Line -match '^#{1,3}\s+') { return 'heading' }
    if ($Line -match '^---\s*$') { return 'hr' }
    if ($Line -match '^\s*-\s+') { return 'list' }
    return 'text'
}

$files = Get-ChildItem -Path $Root -Recurse -File -Filter '*.md'

foreach ($file in $files) {
    $raw = Get-Content -LiteralPath $file.FullName -Raw

    $text = $raw -replace "`r`n", "`n"
    $text = $text -replace "`r", "`n"

    # split collapsed heading/list and tab-separated list chunks
    $text = [regex]::Replace($text, '(?m)^(###\s+.+?)(-\s+\*\*)', '$1`n`n$2')
    $text = [regex]::Replace($text, '(?m)^(##\s+.+?)(-\s+\*\*)', '$1`n`n$2')
    $text = [regex]::Replace($text, "`t-\s+", "`n    - ")

    $lines = $text -split "`n", 0, 'SimpleMatch'
    $normalized = New-Object System.Collections.Generic.List[string]

    foreach ($line in $lines) {
        $l = $line -replace "`t", '    '
        $trim = $l.Trim()

        if ($trim -match '^-\s*--+\s*$' -or $trim -match '^--+\s*$') {
            $normalized.Add('---')
            continue
        }

        if ($l -match '^(#{1,3})\s*') {
            $l = $l -replace '^(#{1,3})\s*', '$1 '
            $normalized.Add($l)
            continue
        }

        if ($l -match '^\s*-\s+') {
            $l = $l -replace '^(\s*)-\s*', '$1- '
            $normalized.Add($l)
            continue
        }

        $normalized.Add($l)
    }

    $out = New-Object System.Collections.Generic.List[string]

    for ($i = 0; $i -lt $normalized.Count; $i++) {
        $line = $normalized[$i]
        $type = Get-LineType -Line $line

        if (($type -eq 'heading' -or $type -eq 'hr') -and $out.Count -gt 0 -and $out[$out.Count - 1].Trim() -ne '') {
            $out.Add('')
        }

        $out.Add($line)

        if ($type -eq 'heading' -or $type -eq 'hr') {
            if ($i -lt $normalized.Count - 1 -and $normalized[$i + 1].Trim() -ne '') {
                $out.Add('')
            }
        }
    }

    $final = New-Object System.Collections.Generic.List[string]
    $blankCount = 0

    foreach ($line in $out) {
        if ($line.Trim() -eq '') {
            $blankCount++
            if ($blankCount -le 2) { $final.Add('') }
        }
        else {
            $blankCount = 0
            $final.Add($line)
        }
    }

    while ($final.Count -gt 0 -and $final[$final.Count - 1].Trim() -eq '') {
        $final.RemoveAt($final.Count - 1)
    }

    $newRaw = ($final -join "`r`n") + "`r`n"

    if ($newRaw -ne $raw) {
        Set-Content -LiteralPath $file.FullName -Value $newRaw -Encoding UTF8
    }
}

Write-Output ("Formatted files under: " + (Resolve-Path $Root))
Write-Output ("Total files scanned: " + $files.Count)
