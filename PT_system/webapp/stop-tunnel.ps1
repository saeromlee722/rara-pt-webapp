Get-Process -Name cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name node -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host 'cloudflared/node 프로세스를 종료했습니다.' -ForegroundColor Green
