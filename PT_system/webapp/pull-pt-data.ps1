Set-Location "C:\Users\saero\iCloudDrive\rara\rara"

# 원격 최신 노트를 로컬 PT_data(Obsidian)로 반영
# 충돌 방지를 위해 rebase 대신 fast-forward only 사용

git fetch origin main
git pull --ff-only origin main
