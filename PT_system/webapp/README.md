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
