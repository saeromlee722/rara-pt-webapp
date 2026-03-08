param(
    [Parameter(Mandatory = $true)]
    [string]$Member,

    [string]$Date = (Get-Date).ToString("yyyy-MM-dd"),

    [string]$Content,

    [string]$ContentFile,

    [string]$VaultRoot = (Get-Location).Path,

    [string]$PtDataDir = "PT_data",

    [string]$Title,

    [string]$FileName
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-NoteDate {
    param([string]$RawDate)

    $formats = @(
        "yyyy-MM-dd",
        "yyyy.MM.dd",
        "yyyy/MM/dd",
        "yy-MM-dd",
        "yy.MM.dd",
        "yy/MM/dd"
    )

    foreach ($format in $formats) {
        try {
            return [datetime]::ParseExact($RawDate, $format, [System.Globalization.CultureInfo]::InvariantCulture)
        }
        catch {
        }
    }

    $fallback = $null
    if ([datetime]::TryParse($RawDate, [ref]$fallback)) {
        return $fallback
    }

    throw "지원하지 않는 날짜 형식입니다: $RawDate"
}

function Get-PlainMemberName {
    param([string]$RawMember)

    $trimmed = $RawMember.Trim()
    if ($trimmed.EndsWith("님")) {
        return $trimmed.Substring(0, $trimmed.Length - 1)
    }
    return $trimmed
}

function Resolve-MemberFolderName {
    param(
        [string]$PtDataPath,
        [string]$RawMember
    )

    $plain = Get-PlainMemberName -RawMember $RawMember
    $candidates = @(
        $RawMember.Trim(),
        $plain,
        "${plain}님"
    ) | Select-Object -Unique

    foreach ($candidate in $candidates) {
        $candidatePath = Join-Path $PtDataPath $candidate
        if (Test-Path -LiteralPath $candidatePath -PathType Container) {
            return $candidate
        }
    }

    return "${plain}님"
}

function Get-ContentPayload {
    param(
        [string]$RawContent,
        [string]$RawContentFile
    )

    if ($RawContent) {
        return $RawContent
    }

    if ($RawContentFile) {
        if (-not (Test-Path -LiteralPath $RawContentFile)) {
            throw "ContentFile 경로를 찾을 수 없습니다: $RawContentFile"
        }
        return Get-Content -LiteralPath $RawContentFile -Raw -Encoding UTF8
    }

    if (-not [Console]::IsInputRedirected) {
        throw "노트 내용이 없습니다. -Content, -ContentFile, 또는 stdin 중 하나를 제공하세요."
    }

    return [Console]::In.ReadToEnd()
}

$noteDate = Resolve-NoteDate -RawDate $Date
$koCulture = [System.Globalization.CultureInfo]::GetCultureInfo("ko-KR")
$displayDate = $noteDate.ToString("yyyy.MM.dd")
$weekday = $noteDate.ToString("dddd", $koCulture)

$plainMember = Get-PlainMemberName -RawMember $Member
$displayMember = "${plainMember}님"

$resolvedPtData = Join-Path $VaultRoot $PtDataDir
New-Item -ItemType Directory -Path $resolvedPtData -Force | Out-Null

$memberFolderName = Resolve-MemberFolderName -PtDataPath $resolvedPtData -RawMember $Member
$memberDir = Join-Path $resolvedPtData $memberFolderName
New-Item -ItemType Directory -Path $memberDir -Force | Out-Null

if (-not $Title) {
    $Title = "💪 $displayDate $weekday $displayMember 수업 노트"
}

if (-not $FileName) {
    $FileName = "💪 {0} {1} 수업 노트.md" -f $displayDate, $displayMember
}

$contentPayload = Get-ContentPayload -RawContent $Content -RawContentFile $ContentFile

$targetPath = Join-Path $memberDir $FileName
$count = 1
while (Test-Path -LiteralPath $targetPath) {
    $nameOnly = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
    $ext = [System.IO.Path]::GetExtension($FileName)
    $targetPath = Join-Path $memberDir ("{0}_{1}{2}" -f $nameOnly, $count, $ext)
    $count++
}

Set-Content -LiteralPath $targetPath -Value $contentPayload -Encoding UTF8
Write-Output $targetPath



