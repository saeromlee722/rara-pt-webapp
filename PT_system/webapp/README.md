# RARA PT Webapp

## 1) 로컬 실행 (같은 Wi-Fi)

```powershell
powershell -ExecutionPolicy Bypass -File PT_system/webapp/run-webapp.ps1
```

- 같은 Wi-Fi에서는 `http://PC내부IP:4173`로 접속 가능

## 2) 외부 접속 (다른 Wi-Fi)

```powershell
powershell -ExecutionPolicy Bypass -File PT_system/webapp/run-tunnel.ps1
```

- 콘솔에 `https://xxxxx.trycloudflare.com` 주소가 뜸
- 그 주소를 휴대폰에서 열면 어디서나 접속 가능
- 창을 닫으면 터널/서버 종료

강제 종료:

```powershell
powershell -ExecutionPolicy Bypass -File PT_system/webapp/stop-tunnel.ps1
```

## API

- `GET /api/system-info`
- `GET /api/members`
- `POST /api/members`
- `GET /api/exercises?q=스미`
- `POST /api/preview`
- `POST /api/save`

## 3) 항상 켜진 웹앱 배포 (Render)

### 준비
1. GitHub에 현재 폴더를 push
2. Render 계정 생성

### 배포
1. Render 대시보드에서 `New +` -> `Blueprint` 선택
2. GitHub repo 연결
3. 루트의 `render.yaml`로 서비스 생성
4. 배포 완료 후 URL 발급

### 저장 경로
- 서버 내부 고정 디스크(`/data`)에 저장
- 실제 수업노트 경로: `/data/PT_data`

### 중요
- 이 방식은 매번 터널 실행 필요 없음
- 서버가 항상 켜져 있으므로 휴대폰에서 URL만 열면 사용 가능

## 4) Render 무료 배포 주의사항

- `render.yaml`은 현재 무료 인스턴스용(`plan: free`)으로 설정됨.
- 무료 배포는 카드 등록 없이 가능한 계정도 있지만, Render 정책/계정 상태에 따라 결제수단이 요구될 수 있음.
- 배포 서버 저장 경로는 Render 서버 내부 경로이며, 로컬 Obsidian(`C:\Users\saero\iCloudDrive\rara\rara\PT_data`)에 즉시 저장되지 않음.
- 로컬 Obsidian 자동 반영이 필요하면 배포 후 별도 동기화(GitHub/Supabase 등) 설정이 추가로 필요.

## 5) 배포 후 자동 동기화 (GitHub -> Obsidian)

### A. Render 환경변수 설정(필수)
Render 서비스 `Environment`에 아래 값을 넣어줘.

- `GIT_SYNC_ENABLED=true`
- `GIT_SYNC_REPO=https://github.com/saeromlee722/rara-pt-webapp.git`
- `GIT_SYNC_BRANCH=main`
- `GIT_SYNC_BASE_DIR=PT_data`
- `GIT_SYNC_AUTHOR_NAME=RARA PT Bot`
- `GIT_SYNC_AUTHOR_EMAIL=saeromlee722@users.noreply.github.com`
- `GIT_SYNC_TOKEN=<GitHub PAT>`  (repo 권한)

동작:
- 웹앱 저장 버튼 클릭 시
- Render 서버가 해당 노트를 GitHub `PT_data/회원명/*.md`로 자동 커밋/푸시

### B. 로컬 Obsidian 자동 반영
로컬 PC에서 아래 스크립트를 주기 실행하면 Obsidian 폴더가 자동 업데이트됨.

- 스크립트: `PT_system/webapp/pull-pt-data.ps1`

수동 실행:
```powershell
powershell -ExecutionPolicy Bypass -File PT_system/webapp/pull-pt-data.ps1
```

권장:
- 작업 스케줄러에서 5~10분 간격으로 실행 등록
