# PT note tools

## 1) Create + save in RARA format

```powershell
powershell -ExecutionPolicy Bypass -File ./PT_system/tools/create-rara-pt-note.ps1 -Date "2026-03-06" -Member "윤남주" -ExerciseText "아웃타이/내로우 레그프레스/밴드 힙쓰러스트" -Special "대퇴골 내회전 경향"
```

Input contract:
- `-Date`: `yyyy-MM-dd`, `yyyy.MM.dd`, `yyyy/MM/dd`, `yy-MM-dd`, `yy.MM.dd`, `yy/MM/dd`
- `-Member`: member name (with or without `님`)
- `-ExerciseText` or `-Exercises`
- `-Special` optional

Engine behavior:
- 운동명 기반 패턴 분류
- 목적/포인트/체감 키워드 자동 추론
- 특이사항 기반 교정 로직 반영
- 다음 수업 연결 방향 추론

## 2) Save pre-written markdown

```powershell
powershell -ExecutionPolicy Bypass -File ./PT_system/tools/save-pt-note.ps1 -Member "윤남주" -Date "2026-03-06" -ContentFile "./note.md"
```

Default file naming:
- `💪 YYYY.MM.DD 회원이름님 수업 노트.md`

If duplicate exists, numeric suffix is appended automatically.
