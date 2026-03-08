param(
    [Parameter(Mandatory = $true)]
    [string]$Member,

    [Parameter(Mandatory = $true)]
    [string]$Date,

    [string[]]$Exercises,

    [string]$ExerciseText,

    [string]$Special,

    [string]$VaultRoot = (Get-Location).Path,

    [string]$PtDataDir = "PT_data",

    [switch]$PreviewOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-NoteDate {
    param([string]$RawDate)

    $formats = @("yyyy-MM-dd", "yyyy.MM.dd", "yyyy/MM/dd", "yy-MM-dd", "yy.MM.dd", "yy/MM/dd")
    foreach ($format in $formats) {
        try { return [datetime]::ParseExact($RawDate, $format, [System.Globalization.CultureInfo]::InvariantCulture) }
        catch {}
    }

    $fallback = $null
    if ([datetime]::TryParse($RawDate, [ref]$fallback)) { return $fallback }
    throw "지원하지 않는 날짜 형식입니다: $RawDate"
}

function Get-PlainMemberName {
    param([string]$RawMember)
    $trimmed = $RawMember.Trim()
    if ($trimmed.EndsWith("님")) { return $trimmed.Substring(0, $trimmed.Length - 1) }
    return $trimmed
}

function Resolve-Exercises {
    param([string[]]$RawExercises, [string]$RawExerciseText)

    $items = @()
    if ($RawExercises) { $items += $RawExercises }
    if ($RawExerciseText) { $items += ($RawExerciseText -split "[\r\n/,]+") }

    $cleaned = $items | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }
    if (-not $cleaned) { throw "운동 목록이 없습니다. -Exercises 또는 -ExerciseText를 입력하세요." }
    return $cleaned
}

function Get-Pattern {
    param([string]$Exercise)

    if ($Exercise -match "트라이셉|삼두|이두|컬|로프") { return "arm_isolation" }
    if ($Exercise -match "힙.*킥백|글루트.*킥백") { return "hip_extension" }
    if ($Exercise -match "쉬러그|페이스풀|전거근|Y레이즈") { return "scapula" }
    if ($Exercise -match "굿모닝|데드리프트|RDL|루마니안|스티프") { return "hip_hinge" }
    if ($Exercise -match "아웃타이|abduction|크램쉘|어브덕") { return "abduction" }
    if ($Exercise -match "힙쓰러스트|브릿지|킥백") { return "hip_extension" }
    if ($Exercise -match "스플릿|불가리안|런지|스텝업|니업") { return "lunge_split" }
    if ($Exercise -match "스쿼트|레그프레스|브이스쿼트|월스쿼트") { return "squat" }
    if ($Exercise -match "이너타이|내전|요가블럭") { return "adduction" }
    if ($Exercise -match "체스트|푸쉬업|플라이|프레스") { return "push_horizontal" }
    if ($Exercise -match "숄더|레이즈|Y프레스|오버헤드") { return "push_vertical" }
    if ($Exercise -match "미드로우|하이로우|로우|벤트오버") { return "pull_horizontal" }
    if ($Exercise -match "랫풀|풀다운|암풀다운|맥그립|로터리") { return "pull_vertical" }
    if ($Exercise -match "플랭크|데드버그|코어|팔로프") { return "core" }
    return "general"
}

function Get-PatternProfile {
    param([string]$Pattern)

    $map = @{
        hip_hinge = @{
            Theme = "힙힌지 안정"; Tag = "힌지 패턴";
            Purpose = "둔근 후면 체인 강화 + 허리 개입 감소";
            Points = @("허리 중립 유지", "엉덩이 뒤로 공간 만들기", "무릎 각도 거의 고정", "골반 정면 유지");
            Keywords = @("허벅지 뒤 길어짐", "엉덩이 아래 묵직함", "허리 부담 감소");
            Muscles = @("햄스트링", "대둔근", "척추기립근");
            Feelings = @("엉덩이 아래 묵직함", "허벅지 뒤 텐션", "허리 부담 적음");
            Signals = @("허리 통증", "골반 열림", "반동 의존");
            Next = "힌지 정밀 제어 강화"
        };
        squat = @{
            Theme = "하체 정렬"; Tag = "정렬 패턴";
            Purpose = "둔근-대퇴사두 협응 + 무릎 정렬 컨트롤";
            Points = @("발바닥 전체 접지", "무릎-발끝 방향 일치", "허리 과신전 금지", "하강 속도 제어");
            Keywords = @("엉덩이 아래 수축", "하체 전체 단단함", "무릎 흔들림 감소");
            Muscles = @("대퇴사두", "대둔근", "내전근");
            Feelings = @("하체 중심 안정", "무릎 흔들림 감소", "엉덩이 사용감");
            Signals = @("무릎 안쪽 붕괴", "발 아치 붕괴", "허리 꺾임");
            Next = "중심선 유지 + 템포 제어"
        };
        lunge_split = @{
            Theme = "한쪽 지지 안정"; Tag = "싱글레그 패턴";
            Purpose = "좌우 밸런스 강화 + 고관절 협응 향상";
            Points = @("앞다리 체중 70~80%", "골반 수평 유지", "무릎 중심선 유지", "몸통 흔들림 최소");
            Keywords = @("앞다리 엉덩이 묵직함", "중심 잡힘", "계단 동작 안정");
            Muscles = @("대둔근", "중둔근", "대퇴사두");
            Feelings = @("한쪽 지지 안정감", "골반 수평 인지", "중심 이동 제어");
            Signals = @("무릎 말림", "골반 기울어짐", "몸통 과흔들림");
            Next = "싱글레그 안정도 향상"
        };
        hip_extension = @{
            Theme = "둔근 수축"; Tag = "신전 패턴";
            Purpose = "둔근 최대 수축 + 고관절 신전 감각 강화";
            Points = @("상단 1~2초 정지", "허리 과신전 금지", "골반 말아 올리기", "무릎 바깥 텐션 유지");
            Keywords = @("엉덩이 위아래 동시 자극", "둔근 잠김", "허리 부담 없음");
            Muscles = @("대둔근", "햄스트링");
            Feelings = @("상단 수축 선명", "둔근 잠금 감각", "허리 편안함");
            Signals = @("허리 과개입", "햄스트링만 과사용", "수축 지점 풀림");
            Next = "상단 수축 유지 시간 확대"
        };
        abduction = @{
            Theme = "중둔근 활성"; Tag = "외전 패턴";
            Purpose = "중둔근 선활성 + 무릎 외전 안정";
            Points = @("골반 고정 유지", "반동 사용 금지", "상단 정지", "텐션 유지");
            Keywords = @("엉덩이 옆 타는 느낌", "골반 안정", "무릎 흔들림 감소");
            Muscles = @("중둔근", "소둔근");
            Feelings = @("엉덩이 옆 자극", "보행 안정", "골반 흔들림 감소");
            Signals = @("TFL 과개입", "골반 들썩임", "반동 수행");
            Next = "외전 유지력 + 하체 패턴 연결"
        };
        adduction = @{
            Theme = "중심선 안정"; Tag = "내전 패턴";
            Purpose = "하체 중심선 안정 + 내전근 활성";
            Points = @("허벅지 안쪽 조임 유지", "발 접지 균등", "골반 하부 안정", "무릎 중심선 유지");
            Keywords = @("허벅지 안쪽 조임", "하체 중심 모임", "골반 아래 안정");
            Muscles = @("내전근", "대퇴사두 내측");
            Feelings = @("중심선 선명", "하체 흔들림 감소", "골반 하부 안정");
            Signals = @("무릎 흔들림", "중심 이탈", "골반 불안정");
            Next = "중심선 제어 강화"
        };
        push_horizontal = @{
            Theme = "가슴 주도 밀기"; Tag = "수평 밀기";
            Purpose = "가슴 주도 패턴 + 어깨 과개입 억제";
            Points = @("견갑 후인하강", "가슴으로 밀어내기", "갈비 들림 금지", "팔 개입 최소화");
            Keywords = @("가슴 중앙 압박", "어깨 앞 부담 감소", "밀기 안정감");
            Muscles = @("대흉근", "전면 삼각근");
            Feelings = @("가슴 수축 선명", "어깨 긴장 감소", "밀기 경로 안정");
            Signals = @("승모 과긴장", "허리 과신전", "어깨 앞 통증");
            Next = "전거근 연결 + 오버헤드 준비"
        };
        push_vertical = @{
            Theme = "오버헤드 안정"; Tag = "수직 밀기";
            Purpose = "삼각근 강화 + 상지 정렬 안정";
            Points = @("허리 과신전 금지", "갈비 들림 금지", "손목-팔꿈치 정렬", "승모 과개입 억제");
            Keywords = @("어깨 전측면 타는 느낌", "목 긴장 없음", "어깨 라인 선명");
            Muscles = @("전면 삼각근", "측면 삼각근");
            Feelings = @("어깨 자극 선명", "상체 중심 안정", "목 긴장 감소");
            Signals = @("승모 과개입", "허리 꺾임", "갈비 들림");
            Next = "견갑 안정 + 전거근 협응"
        };
        pull_horizontal = @{
            Theme = "견갑 후인"; Tag = "수평 당기기";
            Purpose = "등 두께 강화 + 견갑 후인 패턴 정교화";
            Points = @("당기기 전 견갑 먼저", "가슴 고정", "팔꿈치 경로 유지", "반동 금지");
            Keywords = @("등 중앙 묵직함", "날개뼈 붙는 느낌", "팔보다 등 주도");
            Muscles = @("중부 승모", "능형근", "광배근");
            Feelings = @("등 중앙 조여짐", "견갑 움직임 인지", "팔 개입 감소");
            Signals = @("팔만 사용", "목 긴장", "견갑 제어 실패");
            Next = "후인 유지 + 좌우 균형"
        };
        pull_vertical = @{
            Theme = "광배 하강"; Tag = "수직 당기기";
            Purpose = "광배 하강 패턴 + 겨드랑이 아래 감각 형성";
            Points = @("견갑 하강 먼저", "팔보다 광배 사용", "겨드랑이로 끌어내리기", "목 긴장 최소");
            Keywords = @("겨드랑이 아래 당겨짐", "광배 하부 수축", "어깨 들림 감소");
            Muscles = @("광배근", "대원근", "후면 어깨 보조");
            Feelings = @("등 하부 단단함", "당기기 경로 안정", "목 편안함");
            Signals = @("어깨 들림", "팔 개입 과다", "광배 감각 부재");
            Next = "하강→후인→팔 순서 고정"
        };
        scapula = @{
            Theme = "견갑 안정"; Tag = "견갑 패턴";
            Purpose = "견갑 후인·하강·전인 조절 + 승모 부담 감소";
            Points = @("뒤로-아래 세팅", "목 긴장 최소화", "전인/후인 분리", "반동 금지");
            Keywords = @("날개뼈 붙는 느낌", "목 편안함", "어깨 위치 안정");
            Muscles = @("하부 승모", "전거근", "능형근");
            Feelings = @("견갑 위치 선명", "목 부담 감소", "상체 정렬 안정");
            Signals = @("으쓱 패턴", "목 과긴장", "승모 과개입");
            Next = "견갑 리듬 안정 강화"
        };
        arm_isolation = @{
            Theme = "팔 고립"; Tag = "팔 고립";
            Purpose = "상완 고립 수축 + 보상 움직임 억제";
            Points = @("팔꿈치 고정", "반동 금지", "끝 수축 유지", "천천히 이완");
            Keywords = @("목표 부위 펌핑", "수축 선명", "경로 일정");
            Muscles = @("상완이두", "상완삼두", "전완근");
            Feelings = @("팔 자극 선명", "수축 유지", "반동 감소");
            Signals = @("몸통 반동", "손목 꺾임", "관절 통증");
            Next = "정지 구간 + 템포 강화"
        };
        core = @{
            Theme = "복압 안정"; Tag = "코어 패턴";
            Purpose = "복압 유지 + 분절 제어";
            Points = @("호흡 리듬 유지", "골반 중립", "요추 과신전 금지", "코어 긴장 유지");
            Keywords = @("복부 내부 긴장", "몸통 흔들림 감소", "중립 유지");
            Muscles = @("복횡근", "복직근", "기립근 보조");
            Feelings = @("복부 압력 유지", "중심 안정", "허리 부담 감소");
            Signals = @("허리 꺾임", "호흡 끊김", "복압 유지 실패");
            Next = "코어 프리셋 후 메인 연결"
        };
        general = @{
            Theme = "패턴 안정"; Tag = "기본 패턴";
            Purpose = "목표 패턴 안정 + 자극 위치 명확화";
            Points = @("반동 사용 금지", "정렬 우선 유지", "호흡 리듬 유지", "끝지점 제어");
            Keywords = @("자극 부위 선명", "움직임 안정", "속도 제어");
            Muscles = @("전신 안정근");
            Feelings = @("움직임 안정감", "목표 자극 인지", "반복 품질 유지");
            Signals = @("타깃 외 통증", "반동 증가", "정렬 붕괴");
            Next = "기본 패턴 정교화"
        }
    }

    return $map[$Pattern]
}

function Get-SpecialAdjustments {
    param([string]$RawSpecial)

    $adj = @{
        ExtraPoints = @();
        ExtraKeywords = @();
        ExtraSignals = @();
        ExtraNext = @();
        ExtraThemes = @();
    }

    if (-not $RawSpecial) { return $adj }

    if ($RawSpecial -match "내회전|대퇴골|무릎.*붕괴|정렬") {
        $adj.ExtraPoints += @("무릎 중심선 유지", "발 접지 균등", "골반 수평 유지")
        $adj.ExtraKeywords += @("무릎 안쪽 붕괴 감소", "하체 중심선 안정")
        $adj.ExtraSignals += @("무릎 안쪽 말림 반복")
        $adj.ExtraNext += @("외전 선활성 후 하체 패턴 연결", "싱글레그 안정 강화")
        $adj.ExtraThemes += @("중심선 컨트롤")
    }

    if ($RawSpecial -match "외전.*부족|중둔근.*약") {
        $adj.ExtraPoints += @("무릎 바깥 힘 유지", "골반 고정 상태 외전")
        $adj.ExtraKeywords += @("엉덩이 옆 자극 선명")
        $adj.ExtraNext += @("중둔근 지구력 강화")
        $adj.ExtraThemes += @("외전 유지")
    }

    if ($RawSpecial -match "광배|랫|등 하강") {
        $adj.ExtraPoints += @("하강 → 후인 → 팔 순서")
        $adj.ExtraKeywords += @("겨드랑이 아래 당겨짐")
        $adj.ExtraNext += @("암풀다운 선활성 후 랫풀다운 연결")
        $adj.ExtraThemes += @("광배 하강 패턴")
    }

    if ($RawSpecial -match "승모.*과|목.*긴장") {
        $adj.ExtraPoints += @("견갑 하강 우선", "목 긴장 최소화")
        $adj.ExtraSignals += @("승모 과긴장 반복")
        $adj.ExtraNext += @("견갑 안정 루틴 선행")
        $adj.ExtraThemes += @("견갑 재정렬")
    }

    if ($RawSpecial -match "허리.*과|과신전|요추") {
        $adj.ExtraPoints += @("복압 유지", "갈비 들림 제어", "골반 중립")
        $adj.ExtraSignals += @("허리 통증", "허리 과신전 반복")
        $adj.ExtraNext += @("코어 프리셋 후 메인 패턴")
        $adj.ExtraThemes += @("복압 유지")
    }

    return $adj
}

$noteDate = Resolve-NoteDate -RawDate $Date
$displayDate = $noteDate.ToString("yyyy.MM.dd")
$plainMember = Get-PlainMemberName -RawMember $Member
$displayMember = "${plainMember}님"
$exerciseList = Resolve-Exercises -RawExercises $Exercises -RawExerciseText $ExerciseText

$profiles = @()
foreach ($exercise in $exerciseList) {
    $pattern = Get-Pattern -Exercise $exercise
    $profiles += [pscustomobject]@{ Name = $exercise; Pattern = $pattern; Data = Get-PatternProfile -Pattern $pattern }
}

$adj = Get-SpecialAdjustments -RawSpecial $Special

$themes = @($profiles | ForEach-Object { $_.Data.Theme } | Select-Object -Unique)
$themes += $adj.ExtraThemes
$themes = @($themes | Select-Object -Unique)
while ($themes.Count -lt 4) { $themes += "정렬 안정" }
$themes = @($themes | Select-Object -First 4)

$coreArrows = @($profiles | ForEach-Object { $_.Data.Points[0] } | Select-Object -Unique)
$coreArrows += $adj.ExtraPoints
$coreArrows = @($coreArrows | Select-Object -Unique)
while ($coreArrows.Count -lt 4) { $coreArrows += "무게보다 정렬" }
$coreArrows = @($coreArrows | Select-Object -First 4)

$priorityMuscles = @()
if ($profiles.Pattern -contains "arm_isolation") { $priorityMuscles += @("상완삼두", "전완근") }
if ($profiles.Pattern -contains "scapula") { $priorityMuscles += @("하부 승모", "전거근") }
if ($profiles.Pattern -contains "pull_vertical") { $priorityMuscles += @("광배 하부") }
$muscles = @($priorityMuscles + ($profiles | ForEach-Object { $_.Data.Muscles }))
$muscles = @($muscles | Select-Object -Unique | Select-Object -First 7)
$feelings = @($profiles | ForEach-Object { $_.Data.Feelings } | Select-Object -Unique)
$feelings += $adj.ExtraKeywords
$feelings = @($feelings | Select-Object -Unique | Select-Object -First 3)

$signals = @($profiles | ForEach-Object { $_.Data.Signals } | Select-Object -Unique)
$signals += $adj.ExtraSignals
$signals = @($signals | Select-Object -Unique | Select-Object -First 4)

$nextDirs = @($profiles | ForEach-Object { $_.Data.Next } | Select-Object -Unique)
$nextDirs += $adj.ExtraNext
$nextDirs = @($nextDirs | Select-Object -Unique)

$lines = [System.Collections.Generic.List[string]]::new()
$lines.Add("## 🧠 오늘 루틴 핵심 테마")
$lines.Add("")
$lines.Add(("**{0} → {1} → {2} → {3}**" -f $themes[0], $themes[1], $themes[2], $themes[3]))
$lines.Add("")
if ($Special) { $lines.Add("→ 특이사항 반영: $($Special.Trim())  ") }
$lines.Add("→ $($coreArrows[0])  ")
$lines.Add("→ $($coreArrows[1])  ")
$lines.Add("→ $($coreArrows[2])  ")
$lines.Add("→ $($coreArrows[3])")
$lines.Add("")
$lines.Add("---")
$lines.Add("")
$lines.Add("## 🏋️‍♀️ 운동 루틴 + 🔑 동작별 체감 키워드")
$lines.Add("")
$lines.Add("---")
$lines.Add("")

for ($i = 0; $i -lt $profiles.Count; $i++) {
    $p = $profiles[$i]
    $idx = $i + 1

    $points = @($p.Data.Points)
    $keywords = @($p.Data.Keywords)

    foreach ($ep in $adj.ExtraPoints) {
        if ($points -notcontains $ep -and $points.Count -lt 4) { $points += $ep }
    }
    foreach ($ek in $adj.ExtraKeywords) {
        if ($keywords -notcontains $ek -and $keywords.Count -lt 3) { $keywords += $ek }
    }

    $points = @($points | Select-Object -First 4)
    $keywords = @($keywords | Select-Object -First 3)

    $lines.Add("### ${idx}️⃣ $($p.Name)")
    $lines.Add("")
    $lines.Add("_($($p.Data.Tag))_")
    $lines.Add("")
    $lines.Add("- **목적**  ")
    $lines.Add("    $($p.Data.Purpose)")
    $lines.Add("    ")
    $lines.Add("- **포인트**")
    $lines.Add("    ")
    foreach ($pt in $points) {
        $lines.Add("    - $pt")
        $lines.Add("        ")
    }
    $lines.Add("- **🔑 체감 키워드**")
    $lines.Add("    ")
    foreach ($kw in $keywords) {
        $lines.Add("    - $kw")
        $lines.Add("        ")
    }
    $lines.Add("")
    $lines.Add("---")
    $lines.Add("")
}

$lines.Add("## 📌 오늘 루틴 핵심 정리")
$lines.Add("")
$lines.Add("- 무게보다 정렬 우선")
$lines.Add("    ")
$lines.Add("- 자극 위치 선명하게 유지")
$lines.Add("    ")
$lines.Add(("- {0} 패턴 연결 강화" -f $themes[0]))
$lines.Add("    ")
$lines.Add("- 자극 흐려지면  ")
$lines.Add("    → 무게 ↓ / 템포 ↓ / 정렬 재확인")
$lines.Add("    ")
if ($nextDirs.Count -gt 0) {
    $lines.Add(("- 다음 연결: {0}" -f $nextDirs[0]))
    $lines.Add("    ")
}
$lines.Add("")
$lines.Add("---")
$lines.Add("")
$lines.Add("## ⭐ 예상 근육통 부위 안내")
$lines.Add("")
$lines.Add("### ✔ 정상적으로 예상되는 근육통")
$lines.Add("")
foreach ($m in $muscles) { $lines.Add("- $m"); $lines.Add("    ") }
$lines.Add("")
$lines.Add("### ✔ 운동 후 정상적인 느낌")
$lines.Add("")
foreach ($f in $feelings) { $lines.Add("- $f"); $lines.Add("    ") }
$lines.Add("")
$lines.Add("### ⚠ 체크 필요 신호")
$lines.Add("")
foreach ($s in $signals) { $lines.Add("- $s"); $lines.Add("    ") }
$lines.Add("")
$lines.Add("---")
$lines.Add("")
$lines.Add("이날은  ")
$lines.Add(("👉 **`"{0} 중심 패턴을 다음 수업까지 유지하는 날`"**" -f $themes[0]))

$content = $lines -join [Environment]::NewLine
$fileName = "💪 {0} {1} 수업 노트.md" -f $displayDate, $displayMember

if ($PreviewOnly) {
    Write-Output $content
    return
}

$saveScriptPath = Join-Path $PSScriptRoot "save-pt-note.ps1"
$target = & $saveScriptPath -Member $plainMember -Date $Date -Content $content -VaultRoot $VaultRoot -PtDataDir $PtDataDir -FileName $fileName
Write-Output $target
