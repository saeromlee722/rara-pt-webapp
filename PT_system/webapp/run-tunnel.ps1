$ErrorActionPreference = 'Stop'

$root = 'C:\Users\saero\iCloudDrive\rara\rara'
$cloudflared = Join-Path $root 'PT_system\webapp\tools\cloudflared-amd64.exe'
$logDir = Join-Path $root 'PT_system\webapp'
$log = Join-Path $logDir ("tunnel-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + ".log")

if (-not (Test-Path $cloudflared)) {
  Write-Output "cloudflared not found: $cloudflared"
  exit 1
}

Set-Location $root

# 웹앱 서버가 먼저 실행되어 있어야 함
try {
  Invoke-WebRequest -Uri 'http://localhost:4173/api/system-info' -UseBasicParsing -TimeoutSec 3 | Out-Null
} catch {
  Write-Output '웹앱 서버가 꺼져있음. 먼저 실행:'
  Write-Output "powershell -ExecutionPolicy Bypass -File $root\PT_system\webapp\run-webapp.ps1"
  exit 1
}

Write-Output '웹앱 확인 완료 (http://localhost:4173)'
Write-Output 'Cloudflare 터널 시작 중...'
Write-Output "로그 파일: $log"

$proc = Start-Process -FilePath $cloudflared -ArgumentList 'tunnel','--url','http://localhost:4173','--no-autoupdate','--logfile',$log,'--loglevel','info' -PassThru

try {
  $url = $null
  for ($i = 0; $i -lt 80; $i++) {
    Start-Sleep -Milliseconds 500
    if (Test-Path $log) {
      $m = Select-String -Path $log -Pattern 'https://[-a-z0-9]+\.trycloudflare\.com' -AllMatches -ErrorAction SilentlyContinue
      if ($m) {
        $url = $m.Matches[0].Value
        break
      }
    }
  }

  if ($url) {
    Write-Output "외부 접속 URL: $url"
    Write-Output '이 창을 닫으면 터널 종료됨'
  } else {
    Write-Output 'URL 생성 실패. 로그 확인 필요:'
    Write-Output $log
    exit 1
  }

  Wait-Process -Id $proc.Id
}
finally {
  if ($proc -and -not $proc.HasExited) {
    Stop-Process -Id $proc.Id -Force
  }
}
