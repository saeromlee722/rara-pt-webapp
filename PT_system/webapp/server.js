const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const APP_DIR = __dirname;
const ROOT = path.resolve(APP_DIR, '..', '..');
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const PT_DATA_DIR = process.env.PT_DATA_DIR || path.join(ROOT, 'PT_data');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '0.0.0.0';

const GIT_SYNC_ENABLED = String(process.env.GIT_SYNC_ENABLED || '').toLowerCase() === 'true' || String(process.env.GIT_SYNC_ENABLED || '') === '1';
const GIT_SYNC_REPO = process.env.GIT_SYNC_REPO || '';
const GIT_SYNC_BRANCH = process.env.GIT_SYNC_BRANCH || 'main';
const GIT_SYNC_TOKEN = process.env.GIT_SYNC_TOKEN || '';
const GIT_SYNC_BASE_DIR = process.env.GIT_SYNC_BASE_DIR || 'PT_data';
const GIT_SYNC_AUTHOR_NAME = process.env.GIT_SYNC_AUTHOR_NAME || 'RARA PT Bot';
const GIT_SYNC_AUTHOR_EMAIL = process.env.GIT_SYNC_AUTHOR_EMAIL || 'rara-pt-bot@users.noreply.github.com';
const LEARN_DIR = path.join(APP_DIR, 'data');
const LEARN_DB_PATH = path.join(LEARN_DIR, 'movement_overrides.json');
const MOVEMENT_DB_PATH = path.join(LEARN_DIR, 'movement_db.json');
const GPT_API_ENABLED = String(process.env.GPT_API_ENABLED || '').toLowerCase() === 'true' || String(process.env.GPT_API_ENABLED || '') === '1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 25000);

const PATTERN_KEYS = [
  'hinge',
  'squat',
  'split',
  'hipext',
  'abduction',
  'adduction',
  'pushh',
  'pushv',
  'pullh',
  'pullv',
  'scap',
  'arm',
  'core',
  'general',
  'fly'
];

function getLanUrls(port) {
  const urls = [];
  const nets = os.networkInterfaces();
  for (const ifname of Object.keys(nets)) {
    for (const net of nets[ifname] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        urls.push(`http://${net.address}:${port}`);
      }
    }
  }
  return Array.from(new Set(urls)).sort();
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 2_000_000) reject(new Error('Request too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function ensurePtData() {
  if (!fs.existsSync(PT_DATA_DIR)) fs.mkdirSync(PT_DATA_DIR, { recursive: true });
}

function normalizeMemberName(member) {
  const clean = String(member || '').trim();
  if (!clean) return '';
  if (/\(\d{4}\)\s*$/.test(clean)) return clean;
  if (clean.includes('님')) return clean;
  return clean.endsWith('님') ? clean : `${clean}님`;
}

function plainMember(member) {
  return member.endsWith('님') ? member.slice(0, -1) : member;
}

function normalizeMovementKey(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .trim();
}

function ensureLearnDb() {
  if (!fs.existsSync(LEARN_DIR)) fs.mkdirSync(LEARN_DIR, { recursive: true });
  if (!fs.existsSync(LEARN_DB_PATH)) {
    fs.writeFileSync(LEARN_DB_PATH, JSON.stringify({ overrides: {}, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
  }
}

function readLearnDb() {
  ensureLearnDb();
  try {
    const raw = fs.readFileSync(LEARN_DB_PATH, 'utf8');
    const json = JSON.parse(raw);
    if (!json || typeof json !== 'object') return { overrides: {}, updatedAt: null };
    if (!json.overrides || typeof json.overrides !== 'object') json.overrides = {};
    return json;
  } catch {
    return { overrides: {}, updatedAt: null };
  }
}

function writeLearnDb(db) {
  ensureLearnDb();
  fs.writeFileSync(
    LEARN_DB_PATH,
    JSON.stringify({ overrides: db.overrides || {}, updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

function learnMovementPattern(exercise, pattern) {
  const cleanExercise = String(exercise || '').trim();
  const cleanPattern = String(pattern || '').trim();
  if (!cleanExercise) throw new Error('운동명이 비어 있습니다.');
  if (!PATTERN_KEYS.includes(cleanPattern)) throw new Error('유효하지 않은 패턴입니다.');

  const key = normalizeMovementKey(cleanExercise);
  if (!key) throw new Error('운동명이 올바르지 않습니다.');

  const db = readLearnDb();
  db.overrides[key] = cleanPattern;
  writeLearnDb(db);
  return { exercise: cleanExercise, pattern: cleanPattern };
}

function getLearnedPatterns(q) {
  const query = normalizeMovementKey(q || '');
  const db = readLearnDb();
  const items = Object.entries(db.overrides || {})
    .map(([key, pattern]) => ({ key, pattern }))
    .filter(item => !query || item.key.includes(query))
    .sort((a, b) => a.key.localeCompare(b.key, 'ko'));
  return { items, updatedAt: db.updatedAt || null };
}

function readMovementDb() {
  try {
    if (!fs.existsSync(MOVEMENT_DB_PATH)) return { exercises: [] };
    const raw = fs.readFileSync(MOVEMENT_DB_PATH, 'utf8');
    const json = JSON.parse(raw);
    if (!json || typeof json !== 'object' || !Array.isArray(json.exercises)) {
      return { exercises: [] };
    }
    return json;
  } catch {
    return { exercises: [] };
  }
}

function findMovementMeta(exerciseName) {
  const key = normalizeMovementKey(exerciseName);
  if (!key) return null;
  const db = readMovementDb();
  for (const ex of db.exercises || []) {
    const names = [ex.name, ...(Array.isArray(ex.aliases) ? ex.aliases : [])];
    for (const n of names) {
      if (normalizeMovementKey(n) === key) return ex;
    }
  }
  return null;
}

function sanitizeExercises(list) {
  return Array.isArray(list) ? list.map(x => String(x || '').trim()).filter(Boolean) : [];
}

function getMovementContext(exercises) {
  return sanitizeExercises(exercises).map(name => {
    const meta = findMovementMeta(name);
    return {
      name,
      movementPattern: meta?.movementPattern || getPattern(name),
      purpose: Array.isArray(meta?.exercisePurpose) ? meta.exercisePurpose : [],
      coachingPoints: Array.isArray(meta?.coachingPoints) ? meta.coachingPoints : [],
      sensationKeywords: Array.isArray(meta?.sensationKeywords) ? meta.sensationKeywords : [],
      commonErrors: Array.isArray(meta?.commonErrors) ? meta.commonErrors : [],
      nextExerciseLinks: Array.isArray(meta?.nextExerciseLinks) ? meta.nextExerciseLinks : [],
    };
  });
}

function extractResponseText(json) {
  if (!json || typeof json !== 'object') return '';
  if (typeof json.output_text === 'string' && json.output_text.trim()) return json.output_text.trim();
  if (Array.isArray(json.output)) {
    const parts = [];
    for (const item of json.output) {
      if (!item || !Array.isArray(item.content)) continue;
      for (const c of item.content) {
        if (typeof c?.text === 'string') parts.push(c.text);
      }
    }
    const merged = parts.join('\n').trim();
    if (merged) return merged;
  }
  return '';
}

function validateGptNote(markdown, exercises) {
  const text = String(markdown || '');
  if (text.length < 300) return { ok: false, reason: 'too_short' };

  const headings = (text.match(/\d+️⃣\s+/gm) || []).length;
  if (headings < (Array.isArray(exercises) ? exercises.length : 0)) {
    return { ok: false, reason: 'missing_exercise_blocks' };
  }

  const mustHave = ['🧠 역할', '🔧 코칭 포인트', '🔑 체감 키워드', '⚠ 흔한 오류'];
  for (const m of mustHave) {
    if (!text.includes(m)) return { ok: false, reason: `missing_field:${m}` };
  }

  return { ok: true, reason: 'ok' };
}

async function generateNoteWithGpt(payload, fallbackMarkdown, extraInstruction = '') {
  if (!GPT_API_ENABLED) throw new Error('gpt_disabled');
  if (!OPENAI_API_KEY) throw new Error('missing_openai_key');
  if (typeof fetch !== 'function') throw new Error('fetch_not_available');

  const exercises = sanitizeExercises(payload.exercises);
  const movementContext = getMovementContext(exercises);
  const systemPrompt = [
  '너는 라라 PT 수업노트 생성 엔진이다.',
  '출력은 반드시 한국어 마크다운.',
  '코치 메모형 문장으로 짧고 명확하게 작성한다.',
  '설명형 장문, 교과서식 문장 금지.',
  '',
  '=== 전체 구조 (순서 고정) ===',
  '',
  ' 💪 YYYY.MM.DD 요일 회원명 수업 노트',
  '',
  ' 🧠 오늘 루틴 핵심 테마',
  '운동 흐름을 한 줄 화살표로: A → B → C → D',
  '각 운동이 왜 이 순서인지 → 한 줄씩',
  '',
  '---',
  '',
  '# 🏋️‍♀️ 운동 루틴 + 🔑 디테일 코칭',
  '',
  '(운동 개수만큼 아래 블록 반복)',
  '',
  '### n️⃣ 운동명',
  '',
  ' 🧠 역할',
  '이 운동이 오늘 루틴에서 하는 역할 한 줄',
  '',
  ' 🎯 목적',
  '- 목적 1',
  '- 목적 2',
  '- 목적 3',
  '',
  ' 🔧 코칭 포인트',
  '- 포인트 1 (감각 언어로)',
  '- 포인트 2',
  '- 포인트 3',
  '- 포인트 4',
  '',
  ' 🔑 체감 키워드',
  '- 키워드 1',
  '- 키워드 2',
  '- 키워드 3',
  '',
  ' ⚠ 흔한 오류',
  '- 오류 1',
  '- 오류 2',
  '- 오류 3',
  '',
  ' 👉 다음 운동 연결',
  '이 운동 후 다음 운동으로 어떻게 연결되는지 한 줄',
  '',
  '---',
  '',
  '# 📌 오늘 핵심 피드백',
  '오늘 전체 흐름 평가 + 개선 포인트 2~3개',
  '',
  ' ⭐ 예상 근육통',
  '- 근육명',
  '',
  ' ⚠ 체크 포인트',
  '- 다음 수업 전 확인할 것',
  '',
  ' 📌 다음 수업 방향',
  '- 방향 1',
  '- 방향 2',
  '',
  ' 💡 오늘 한 줄 정리',
  '👉 **"한 줄 요약"**',
  '',
  '=== 규칙 ===',
  '- 운동명은 입력 순서 그대로 사용',
  '- 하체/상체 맥락 절대 혼동 금지',
  '- 로우/풀다운 계열: 팔 개입 최소, 견갑 순서, 등 체감 중심',
  '- 불필요한 영어 혼용 최소화 (운동명 제외)',
  '- 각 블록 충분히 구체적으로 작성 (얕은 내용 금지)',
].join('\n');
  
  const userPayload = {
    date: payload.date,
    member: payload.member,
    exercises,
    special: payload.special || '',
    movementContext
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
          {
            role: 'user',
            content: [{
              type: 'input_text',
              text: [
                '다음 입력으로 수업노트를 생성해줘.',
                JSON.stringify(userPayload, null, 2),
                '아래는 운동 맥락 참고용 초안이다. 내용(운동명, 근육, 코칭 포인트)은 참고하되, 형식은 반드시 위 시스템 프롬프트 구조를 따를 것:',
                fallbackMarkdown,
                extraInstruction ? `추가 지시:\n${extraInstruction}` : ''
              ].join('\n\n')
            }]
          }
        ]
        ,
        max_output_tokens: 3500
      }),
      signal: controller.signal,
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = json?.error?.message || `openai_http_${res.status}`;
      throw new Error(msg);
    }

    const text = extractResponseText(json);
    if (!text) throw new Error('empty_gpt_output');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function generateNoteMarkdown(payload) {
  const built = buildNote(payload);
  const fallbackChecked = spellCheckMarkdown(built.markdown);
  const useGpt = payload && payload.useGpt === true;

  if (!useGpt) {
    return {
      markdown: fallbackChecked.text,
      corrections: fallbackChecked.corrections,
      engine: 'rule',
      gptError: null,
    };
  }

  try {
    let gptMarkdown = await generateNoteWithGpt(payload, fallbackChecked.text);
    let check = validateGptNote(gptMarkdown, payload.exercises);

    if (!check.ok) {
      gptMarkdown = await generateNoteWithGpt(
        payload,
        fallbackChecked.text,
        `이전 출력 문제: ${check.reason}. 반드시 섹션/운동 블록을 완전하게 다시 생성해.`
      );
      check = validateGptNote(gptMarkdown, payload.exercises);
      if (!check.ok) throw new Error(`gpt_quality_check_failed:${check.reason}`);
    }

    const checked = spellCheckMarkdown(gptMarkdown);
    return { markdown: checked.text, corrections: checked.corrections, engine: 'gpt' };
  } catch (err) {
    return {
      markdown: fallbackChecked.text,
      corrections: fallbackChecked.corrections,
      engine: 'rule',
      gptError: String(err?.message || err),
    };
  }
}

function getMembers() {
  ensurePtData();
  return fs.readdirSync(PT_DATA_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort((a, b) => a.localeCompare(b, 'ko'));
}

function extractExercisesFromFile(filePath, set) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const patterns = [/^###\s+\d+️⃣\s+(.+)$/, /^##\s+\d+️⃣\s+(.+)$/, /^\d+️⃣\s+(.+)$/];
  for (const line of lines) {
    const trimmed = line.trim();
    for (const p of patterns) {
      const m = trimmed.match(p);
      if (m && m[1]) {
        set.add(m[1].trim());
        break;
      }
    }
  }
}

function getExerciseSuggestions(query) {
  const set = new Set();
  for (const memberDir of getMembers()) {
    const absMember = path.join(PT_DATA_DIR, memberDir);
    for (const file of fs.readdirSync(absMember, { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith('.md')) {
        extractExercisesFromFile(path.join(absMember, file.name), set);
      }
    }
  }

  const all = Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'));
  const q = String(query || '').trim();
  if (!q) return all.slice(0, 100);
  return all.filter(x => x.includes(q)).slice(0, 30);
}

function parseDate(raw) {
  const clean = String(raw || '').trim();
  const m = clean.match(/^(\d{2,4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (!m) throw new Error('날짜 형식이 올바르지 않습니다.');

  let year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 100) year += 2000;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    throw new Error('유효하지 않은 날짜입니다.');
  }
  return d;
}

function getWeekdayKo(dateObj) {
  return ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'][dateObj.getDay()];
}

function getPattern(ex) {
  const learned = readLearnDb().overrides || {};
  const key = normalizeMovementKey(ex);
  if (key && learned[key]) return learned[key];

  const meta = findMovementMeta(ex);
  if (meta && typeof meta.movementPattern === 'string' && PATTERN_KEYS.includes(meta.movementPattern)) {
    return meta.movementPattern;
  }

  if (/카프레이즈|calf/.test(ex)) return 'squat';
  if (/레그컬|leg\\s*curl|햄스트링.*컬/.test(ex)) return 'hipext';
  if (/트라이셉|삼두|이두|컬|로프/.test(ex)) return 'arm';
  if (/힙.*킥백|글루트.*킥백/.test(ex)) return 'hipext';
  if (/몬스터.*글루트|글루트.*어브덕|힙.*어브덕|어브덕션/.test(ex)) return 'abduction';
  // Shoulder/overhead presses must be matched before generic "프레스"
  if (/숄더|어깨|오버헤드|바이킹.*프레스|프론트.*프레스|Y프레스|레터럴|레이즈/.test(ex)) return 'pushv';
  if (/쉬러그|페이스풀|전거근|Y레이즈/.test(ex)) return 'scap';
  if (/굿모닝|데드리프트|RDL|루마니안|스티프/.test(ex)) return 'hinge';
  if (/아웃타이|abduction|크램쉘|어브덕/.test(ex)) return 'abduction';
  if (/힙쓰러스트|브릿지|킥백/.test(ex)) return 'hipext';
  if (/스플릿|불가리안|런지|스텝업|니업/.test(ex)) return 'split';
  if (/스쿼트|레그프레스|브이스쿼트|브이스퀏트|월스쿼트/.test(ex)) return 'squat';
  if (/이너타이|내전|요가블럭/.test(ex)) return 'adduction';
  if (/플라이|펙덱|케이블크로스|체스트플라이/.test(ex)) return 'fly';
  if (/체스트|푸쉬업|프레스/.test(ex)) return 'pushh';
  if (/미드로우|하이로우|로우|벤트오버/.test(ex)) return 'pullh';
  if (/랫풀|풀다운|암풀다운|맥그립|로터리/.test(ex)) return 'pullv';
  if (/플랭크|데드버그|코어|팔로프/.test(ex)) return 'core';
  return 'general';
}

const PROFILES = {
  hinge: { theme: '힙힌지 안정', tag: '힌지 패턴', purpose: '둔근 후면 체인 강화 + 허리 개입 감소', points: ['허리 중립 유지', '엉덩이 뒤로 공간 만들기', '무릎 각도 거의 고정', '골반 정면 유지'], keywords: ['허벅지 뒤 길어짐', '엉덩이 아래 묵직함', '허리 부담 감소'], muscles: ['햄스트링', '대둔근', '척추기립근'], feelings: ['엉덩이 아래 묵직함', '허벅지 뒤 텐션', '허리 부담 적음'], signals: ['허리 통증', '골반 열림', '반동 의존'], next: '힌지 정밀 제어 강화' },
  squat: { theme: '하체 정렬', tag: '정렬 패턴', purpose: '둔근-대퇴사두 협응 + 무릎 정렬 컨트롤', points: ['발바닥 전체 접지', '무릎-발끝 방향 일치', '허리 과신전 금지', '하강 속도 제어'], keywords: ['엉덩이 아래 수축', '하체 전체 단단함', '무릎 흔들림 감소'], muscles: ['대퇴사두', '대둔근', '내전근'], feelings: ['하체 중심 안정', '무릎 흔들림 감소', '엉덩이 사용감'], signals: ['무릎 안쪽 붕괴', '발 아치 붕괴', '허리 꺾임'], next: '중심선 유지 + 템포 제어' },
  split: { theme: '한쪽 지지 안정', tag: '싱글레그 패턴', purpose: '좌우 밸런스 강화 + 고관절 협응 향상', points: ['앞다리 체중 70~80%', '골반 수평 유지', '무릎 중심선 유지', '몸통 흔들림 최소'], keywords: ['앞다리 엉덩이 묵직함', '중심 잡힘', '계단 동작 안정'], muscles: ['대둔근', '중둔근', '대퇴사두'], feelings: ['한쪽 지지 안정감', '골반 수평 인지', '중심 이동 제어'], signals: ['무릎 말림', '골반 기울어짐', '몸통 과흔들림'], next: '싱글레그 안정도 향상' },
  hipext: { theme: '둔근 수축', tag: '신전 패턴', purpose: '둔근 최대 수축 + 고관절 신전 감각 강화', points: ['상단 1~2초 정지', '허리 과신전 금지', '골반 말아 올리기', '무릎 바깥 텐션 유지'], keywords: ['엉덩이 위아래 동시 자극', '둔근 잠김', '허리 부담 없음'], muscles: ['대둔근', '햄스트링'], feelings: ['상단 수축 선명', '둔근 잠금 감각', '허리 편안함'], signals: ['허리 과개입', '햄스트링만 과사용', '수축 지점 풀림'], next: '상단 수축 유지 시간 확대' },
  abduction: { theme: '중둔근 활성', tag: '외전 패턴', purpose: '중둔근 선활성 + 무릎 외전 안정', points: ['골반 고정 유지', '반동 사용 금지', '상단 정지', '텐션 유지'], keywords: ['엉덩이 옆 타는 느낌', '골반 안정', '무릎 흔들림 감소'], muscles: ['중둔근', '소둔근'], feelings: ['엉덩이 옆 자극', '보행 안정', '골반 흔들림 감소'], signals: ['TFL 과개입', '골반 들썩임', '반동 수행'], next: '외전 유지력 + 하체 패턴 연결' },
  adduction: { theme: '중심선 안정', tag: '내전 패턴', purpose: '하체 중심선 안정 + 내전근 활성', points: ['허벅지 안쪽 조임 유지', '발 접지 균등', '골반 하부 안정', '무릎 중심선 유지'], keywords: ['허벅지 안쪽 조임', '하체 중심 모임', '골반 아래 안정'], muscles: ['내전근', '대퇴사두 내측'], feelings: ['중심선 선명', '하체 흔들림 감소', '골반 하부 안정'], signals: ['무릎 흔들림', '중심 이탈', '골반 불안정'], next: '중심선 제어 강화' },
  pushh: { theme: '가슴 주도 밀기', tag: '수평 밀기', purpose: '가슴 주도 패턴 + 어깨 과개입 억제', points: ['견갑 후인하강', '가슴으로 밀어내기', '갈비 들림 금지', '팔 개입 최소화'], keywords: ['가슴 중앙 압박', '어깨 앞 부담 감소', '밀기 안정감'], muscles: ['대흉근', '전면 삼각근'], feelings: ['가슴 수축 선명', '어깨 긴장 감소', '밀기 경로 안정'], signals: ['승모 과긴장', '허리 과신전', '어깨 앞 통증'], next: '전거근 연결 + 오버헤드 준비' },
  pushv: { theme: '오버헤드 안정', tag: '수직 밀기', purpose: '삼각근 강화 + 상지 정렬 안정', points: ['허리 과신전 금지', '갈비 들림 금지', '손목-팔꿈치 정렬', '승모 과개입 억제'], keywords: ['어깨 전측면 타는 느낌', '목 긴장 없음', '어깨 라인 선명'], muscles: ['전면 삼각근', '측면 삼각근'], feelings: ['어깨 자극 선명', '상체 중심 안정', '목 긴장 감소'], signals: ['승모 과개입', '허리 꺾임', '갈비 들림'], next: '견갑 안정 + 전거근 협응' },
  pullh: { theme: '견갑 후인', tag: '수평 당기기', purpose: '등 두께 강화 + 견갑 후인 패턴 정교화', points: ['당기기 전 견갑 먼저', '가슴 고정', '팔꿈치 경로 유지', '반동 금지'], keywords: ['등 중앙 묵직함', '날개뼈 붙는 느낌', '팔보다 등 주도'], muscles: ['중부 승모', '능형근', '광배근'], feelings: ['등 중앙 조여짐', '견갑 움직임 인지', '팔 개입 감소'], signals: ['팔만 사용', '목 긴장', '견갑 제어 실패'], next: '후인 유지 + 좌우 균형' },
  pullv: { theme: '광배 하강', tag: '수직 당기기', purpose: '광배 하강 패턴 + 겨드랑이 아래 감각 형성', points: ['견갑 하강 먼저', '팔보다 광배 사용', '겨드랑이로 끌어내리기', '목 긴장 최소'], keywords: ['겨드랑이 아래 당겨짐', '광배 하부 수축', '어깨 들림 감소'], muscles: ['광배근', '대원근', '후면 어깨 보조'], feelings: ['등 하부 단단함', '당기기 경로 안정', '목 편안함'], signals: ['어깨 들림', '팔 개입 과다', '광배 감각 부재'], next: '하강→후인→팔 순서 고정' },
  scap: { theme: '견갑 안정', tag: '견갑 패턴', purpose: '견갑 후인·하강·전인 조절 + 승모 부담 감소', points: ['뒤로-아래 세팅', '목 긴장 최소화', '전인/후인 분리', '반동 금지'], keywords: ['날개뼈 붙는 느낌', '목 편안함', '어깨 위치 안정'], muscles: ['하부 승모', '전거근', '능형근'], feelings: ['견갑 위치 선명', '목 부담 감소', '상체 정렬 안정'], signals: ['으쓱 패턴', '목 과긴장', '승모 과개입'], next: '견갑 리듬 안정 강화' },
  arm: { theme: '팔 고립', tag: '팔 고립', purpose: '상완 고립 수축 + 보상 움직임 억제', points: ['팔꿈치 고정', '반동 금지', '끝 수축 유지', '천천히 이완'], keywords: ['목표 부위 펌핑', '수축 선명', '경로 일정'], muscles: ['상완이두', '상완삼두', '전완근'], feelings: ['팔 자극 선명', '수축 유지', '반동 감소'], signals: ['몸통 반동', '손목 꺾임', '관절 통증'], next: '정지 구간 + 템포 강화' },
  core: { theme: '복압 안정', tag: '코어 패턴', purpose: '복압 유지 + 분절 제어', points: ['호흡 리듬 유지', '골반 중립', '요추 과신전 금지', '코어 긴장 유지'], keywords: ['복부 내부 긴장', '몸통 흔들림 감소', '중립 유지'], muscles: ['복횡근', '복직근', '기립근 보조'], feelings: ['복부 압력 유지', '중심 안정', '허리 부담 감소'], signals: ['허리 꺾임', '호흡 끊김', '복압 유지 실패'], next: '코어 프리셋 후 메인 연결' },
  general: { theme: '패턴 안정', tag: '기본 패턴', purpose: '목표 패턴 안정 + 자극 위치 명확화', points: ['반동 사용 금지', '정렬 우선 유지', '호흡 리듬 유지', '끝지점 제어'], keywords: ['자극 부위 선명', '움직임 안정', '속도 제어'], muscles: ['전신 안정근'], feelings: ['움직임 안정감', '목표 자극 인지', '반복 품질 유지'], signals: ['타깃 외 통증', '반동 증가', '정렬 붕괴'], next: '기본 패턴 정교화' },
fly: { 
  theme: '가슴 수평 모으기', 
  tag: '수평 모으기', 
  purpose: '흉근 고립 수축 + 어깨 안전 범위 유지', 
  points: ['팔이 아니라 가슴으로 모은다', '어깨 말림 방지', '수축 지점 1초 유지', '반동 없이 컨트롤'], 
  keywords: ['가슴 가운데 조여짐', '가슴으로 모이는 느낌', '어깨 개입 최소'], 
  muscles: ['대흉근', '전면 삼각근 보조'], 
  feelings: ['가슴 중앙 압박', '어깨 부담 없음', '수축 선명'], 
  signals: ['어깨 앞으로 말림', '팔로만 모으기', '반동 사용'], 
  next: '가슴 활성 → 프레스 또는 로우 연결' 
},};

function specialAdj(special) {
  const s = String(special || '');
  const out = { extraPoints: [], extraKeywords: [], extraSignals: [], extraNext: [], extraThemes: [] };

  if (/내회전|대퇴골|무릎.*붕괴|정렬/.test(s)) {
    out.extraPoints.push('무릎 중심선 유지', '발 접지 균등', '골반 수평 유지');
    out.extraKeywords.push('무릎 안쪽 붕괴 감소', '하체 중심선 안정');
    out.extraSignals.push('무릎 안쪽 말림 반복');
    out.extraNext.push('외전 선활성 후 하체 패턴 연결', '싱글레그 안정 강화');
    out.extraThemes.push('중심선 컨트롤');
  }
  if (/외전.*부족|중둔근.*약/.test(s)) {
    out.extraPoints.push('무릎 바깥 힘 유지', '골반 고정 상태 외전');
    out.extraKeywords.push('엉덩이 옆 자극 선명');
    out.extraNext.push('중둔근 지구력 강화');
    out.extraThemes.push('외전 유지');
  }
  if (/광배|랫|등 하강/.test(s)) {
    out.extraPoints.push('하강 → 후인 → 팔 순서');
    out.extraKeywords.push('겨드랑이 아래 당겨짐');
    out.extraNext.push('암풀다운 선활성 후 랫풀다운 연결');
    out.extraThemes.push('광배 하강 패턴');
  }
  if (/승모.*과|목.*긴장/.test(s)) {
    out.extraPoints.push('견갑 하강 우선', '목 긴장 최소화');
    out.extraSignals.push('승모 과긴장 반복');
    out.extraNext.push('견갑 안정 루틴 선행');
    out.extraThemes.push('견갑 재정렬');
  }
  if (/허리.*과|과신전|요추/.test(s)) {
    out.extraPoints.push('복압 유지', '갈비 들림 제어', '골반 중립');
    out.extraSignals.push('허리 통증', '허리 과신전 반복');
    out.extraNext.push('코어 프리셋 후 메인 패턴');
    out.extraThemes.push('복압 유지');
  }

  return out;
}

function uniq(arr) {
  return Array.from(new Set(arr));
}
function spellCheckMarkdown(text) {
  let out = String(text || '');
  const corrections = [];

  const rules = [
    { pattern: /됬/g, replace: '됐', label: '됬 → 됐' },
    { pattern: /되여/g, replace: '되어', label: '되여 → 되어' },
    { pattern: /몇일/g, replace: '며칠', label: '몇일 → 며칠' },
    { pattern: /할께/g, replace: '할게', label: '할께 → 할게' },
    { pattern: /않되/g, replace: '안 되', label: '않되 → 안 되' },
    { pattern: /안되/g, replace: '안 돼', label: '안되 → 안 돼' },
    { pattern: /되는대/g, replace: '되는데', label: '되는대 → 되는데' },
    { pattern: /[ \t]{2,}/g, replace: ' ', label: '연속 공백 정리' },
  ];

  for (const r of rules) {
    const before = out;
    out = out.replace(r.pattern, r.replace);
    if (before !== out) corrections.push(r.label);
  }

  out = out
    .replace(/\n {1,3}- \*\*/g, '\n- **')
    .replace(/\n {1,3}→/g, '\n→')
    .replace(/[ \t]+\n/g, '\n');

  return { text: out, corrections: Array.from(new Set(corrections)) };
}

function buildNote(payload) {
  const member = normalizeMemberName(payload.member);
  const dateObj = parseDate(payload.date);
  const displayDate = `${dateObj.getFullYear()}.${String(dateObj.getMonth() + 1).padStart(2, '0')}.${String(dateObj.getDate()).padStart(2, '0')}`;
  const weekday = getWeekdayKo(dateObj);

  const exercises = Array.isArray(payload.exercises)
    ? payload.exercises.map(x => String(x).trim()).filter(Boolean)
    : [];
  if (!member) throw new Error('회원 이름이 비어 있습니다.');
  if (exercises.length === 0) throw new Error('운동 목록이 비어 있습니다.');

  const profiles = exercises.map(name => {
    const pattern = getPattern(name);
    const base = PROFILES[pattern] || PROFILES.general;
    const meta = findMovementMeta(name);

    if (!meta) return { name, pattern, data: base };

    const metaPurpose = Array.isArray(meta.exercisePurpose) && meta.exercisePurpose.length > 0
      ? meta.exercisePurpose.join(' + ')
      : base.purpose;
    const metaPoints = Array.isArray(meta.coachingPoints) && meta.coachingPoints.length > 0
      ? meta.coachingPoints
      : base.points;
    const metaKeywords = Array.isArray(meta.sensationKeywords) && meta.sensationKeywords.length > 0
      ? meta.sensationKeywords
      : base.keywords;
    const metaMuscles = [
      ...(Array.isArray(meta.primaryTargetMuscles) ? meta.primaryTargetMuscles : []),
      ...(Array.isArray(meta.secondaryMuscles) ? meta.secondaryMuscles : []),
    ];
    const metaSignals = Array.isArray(meta.commonErrors) && meta.commonErrors.length > 0
      ? meta.commonErrors
      : base.signals;
    const metaNext = Array.isArray(meta.nextExerciseLinks) && meta.nextExerciseLinks.length > 0
      ? `${meta.nextExerciseLinks.join(' + ')} 연결`
      : base.next;
    const metaTag = typeof meta.movementPattern === 'string' && meta.movementPattern
      ? meta.movementPattern
      : base.tag;

    return {
      name,
      pattern,
      data: {
        theme: base.theme,
        tag: metaTag,
        purpose: metaPurpose,
        points: metaPoints,
        keywords: metaKeywords,
        muscles: metaMuscles.length > 0 ? metaMuscles : base.muscles,
        feelings: metaKeywords,
        signals: metaSignals,
        next: metaNext,
      },
    };
  });

  const adj = specialAdj(payload.special);

  let themes = uniq([...profiles.map(p => p.data.theme), ...adj.extraThemes]);
  while (themes.length < 4) themes.push('정렬 안정');
  themes = themes.slice(0, 4);

  let arrows = uniq([...profiles.map(p => p.data.points[0]), ...adj.extraPoints]);
  while (arrows.length < 4) arrows.push('무게보다 정렬');
  arrows = arrows.slice(0, 4);

  const priorityMuscles = [];
  if (profiles.some(p => p.pattern === 'arm')) priorityMuscles.push('상완삼두', '전완근');
  if (profiles.some(p => p.pattern === 'scap')) priorityMuscles.push('하부 승모', '전거근');
  if (profiles.some(p => p.pattern === 'pullv')) priorityMuscles.push('광배 하부');

  const muscles = uniq([...priorityMuscles, ...profiles.flatMap(p => p.data.muscles)]).slice(0, 7);
  const feelings = uniq([...profiles.flatMap(p => p.data.feelings), ...adj.extraKeywords]).slice(0, 3);
  const signals = uniq([...profiles.flatMap(p => p.data.signals), ...adj.extraSignals]).slice(0, 4);
  const nextDirs = uniq([...profiles.map(p => p.data.next), ...adj.extraNext]);

  const lines = [];
  lines.push(`# 💪 ${displayDate} ${weekday} ${member} 수업 노트`, '');
  lines.push('## 🧠 오늘 루틴 핵심 테마', '');
  lines.push(`**${themes[0]} → ${themes[1]} → ${themes[2]} → ${themes[3]}**`, '');
  if (payload.special && String(payload.special).trim()) lines.push(`→ 특이사항 반영: ${String(payload.special).trim()}  `);
  lines.push(`→ ${arrows[0]}  `, `→ ${arrows[1]}  `, `→ ${arrows[2]}  `, `→ ${arrows[3]}`, '', '---', '');
  lines.push('## 🏋️‍♀️ 운동 루틴 + 🔑 동작별 체감 키워드', '', '---', '');

  profiles.forEach((p, idx) => {
    const points = uniq([...p.data.points, ...adj.extraPoints]).slice(0, 4);
    const keywords = uniq([...p.data.keywords, ...adj.extraKeywords]).slice(0, 3);

    lines.push(`### ${idx + 1}️⃣ ${p.name}`, '');
    lines.push(`_(${p.data.tag})_`, '');
    lines.push('- **목적**  ', `    ${p.data.purpose}`, '    ');
    lines.push('- **포인트**', '    ');
    points.forEach(pt => lines.push(`    - ${pt}`, '        '));
    lines.push('- **🔑 체감 키워드**', '    ');
    keywords.forEach(kw => lines.push(`    - ${kw}`, '        '));
    lines.push('', '---', '');
  });

  lines.push('## 📌 오늘 루틴 핵심 정리', '');
  lines.push('- 무게보다 정렬 우선', '    ');
  lines.push('- 자극 위치 선명하게 유지', '    ');
  lines.push(`- ${themes[0]} 패턴 연결 강화`, '    ');
  lines.push('- 자극 흐려지면  ', '    → 무게 ↓ / 템포 ↓ / 정렬 재확인', '    ');
  if (nextDirs.length > 0) lines.push(`- 다음 연결: ${nextDirs[0]}`, '    ');
  lines.push('', '---', '');

  lines.push('## ⭐ 예상 근육통 부위 안내', '');
  lines.push('### ✔ 정상적으로 예상되는 근육통', '');
  muscles.forEach(m => lines.push(`- ${m}`, '    '));
  lines.push('', '### ✔ 운동 후 정상적인 느낌', '');
  feelings.forEach(f => lines.push(`- ${f}`, '    '));
  lines.push('', '### ⚠ 체크 필요 신호', '');
  signals.forEach(s => lines.push(`- ${s}`, '    '));
  lines.push('', '---', '', '이날은  ');
  lines.push(`👉 **"${themes[0]} 중심 패턴을 다음 수업까지 유지하는 날"**`);

  const markdown = lines.join('\n');
  const fileName = `💪 ${displayDate} ${weekday} ${member} 수업 노트.md`;

  return { markdown, member, fileName };
}

function resolveMemberFolder(member) {
  const plain = plainMember(member);
  const candidates = [member, plain, `${plain}님`];
  for (const c of candidates) {
    const p = path.join(PT_DATA_DIR, c);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return c;
  }
  return `${plain}님`;
}

function uniquePath(dir, fileName) {
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let i = 0;
  while (true) {
    const candidate = i === 0 ? `${base}${ext}` : `${base}_${i}${ext}`;
    const abs = path.join(dir, candidate);
    if (!fs.existsSync(abs)) return abs;
    i += 1;
  }
}
function listMemberNotes(member, q) {
  const normalized = normalizeMemberName(member);
  if (!normalized) throw new Error('회원 이름이 비어 있습니다.');

  const folder = resolveMemberFolder(normalized);
  const absDir = path.join(PT_DATA_DIR, folder);
  if (!fs.existsSync(absDir)) return { member: folder, notes: [] };

  const query = String(q || '').trim();
  const notes = fs.readdirSync(absDir, { withFileTypes: true })
    .filter(d => d.isFile() && d.name.endsWith('.md'))
    .map(d => {
      const fullPath = path.join(absDir, d.name);
      const stat = fs.statSync(fullPath);
      return {
        fileName: d.name,
        fullPath,
        updatedAt: stat.mtime.toISOString(),
      };
    })
    .filter(n => !query || n.fileName.includes(query))
    .sort((a, b) => b.fileName.localeCompare(a.fileName, 'ko'));

  return { member: folder, notes };
}
function runGit(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || 'git command failed').trim());
  }
  return r.stdout || '';
}

function maybeSyncToGitHub(memberFolder, fileName, content) {
  if (!GIT_SYNC_ENABLED) return { enabled: false, synced: false, reason: 'sync_disabled' };
  if (!GIT_SYNC_REPO || !GIT_SYNC_TOKEN) return { enabled: true, synced: false, reason: 'missing_repo_or_token' };

  const stamp = Date.now().toString() + '-' + Math.random().toString(16).slice(2);
  const workDir = path.join(os.tmpdir(), 'rara-pt-sync-' + stamp);

  try {
    const authedRepo = GIT_SYNC_REPO.replace('https://', 'https://x-access-token:' + encodeURIComponent(GIT_SYNC_TOKEN) + '@');

    runGit(['clone', '--depth', '1', '--branch', GIT_SYNC_BRANCH, authedRepo, workDir], process.cwd());

    runGit(['config', 'user.name', GIT_SYNC_AUTHOR_NAME], workDir);
    runGit(['config', 'user.email', GIT_SYNC_AUTHOR_EMAIL], workDir);

    const rel = path.join(GIT_SYNC_BASE_DIR, memberFolder, fileName);
    const abs = path.join(workDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');

    runGit(['add', rel], workDir);

    const diff = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: workDir, encoding: 'utf8' });
    if (diff.status === 0) {
      return { enabled: true, synced: true, reason: 'no_changes' };
    }

    const message = 'sync: ' + memberFolder + '/' + fileName;
    runGit(['commit', '-m', message], workDir);
    runGit(['push', 'origin', GIT_SYNC_BRANCH], workDir);

    return { enabled: true, synced: true, reason: 'pushed' };
  } catch (err) {
    return { enabled: true, synced: false, reason: String(err.message || err) };
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}
function maybeDeleteFromGitHub(memberFolder, fileName) {
  if (!GIT_SYNC_ENABLED) return { enabled: false, synced: false, reason: 'sync_disabled' };
  if (!GIT_SYNC_REPO || !GIT_SYNC_TOKEN) return { enabled: true, synced: false, reason: 'missing_repo_or_token' };

  const stamp = Date.now().toString() + '-' + Math.random().toString(16).slice(2);
  const workDir = path.join(os.tmpdir(), 'rara-pt-sync-del-' + stamp);

  try {
    const authedRepo = GIT_SYNC_REPO.replace('https://', 'https://x-access-token:' + encodeURIComponent(GIT_SYNC_TOKEN) + '@');

    runGit(['clone', '--depth', '1', '--branch', GIT_SYNC_BRANCH, authedRepo, workDir], process.cwd());
    runGit(['config', 'user.name', GIT_SYNC_AUTHOR_NAME], workDir);
    runGit(['config', 'user.email', GIT_SYNC_AUTHOR_EMAIL], workDir);

    const rel = path.join(GIT_SYNC_BASE_DIR, memberFolder, fileName);
    const abs = path.join(workDir, rel);
    if (fs.existsSync(abs)) fs.rmSync(abs, { force: true });

    runGit(['add', '-A', rel], workDir);

    const diff = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: workDir, encoding: 'utf8' });
    if (diff.status === 0) {
      return { enabled: true, synced: true, reason: 'no_changes' };
    }

    const message = 'delete: ' + memberFolder + '/' + fileName;
    runGit(['commit', '-m', message], workDir);
    runGit(['push', 'origin', GIT_SYNC_BRANCH], workDir);

    return { enabled: true, synced: true, reason: 'pushed' };
  } catch (err) {
    return { enabled: true, synced: false, reason: String(err.message || err) };
  } finally {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}
async function previewNote(payload) {
  return await generateNoteMarkdown(payload);
}

async function saveNote(payload) {
  ensurePtData();
  const generated = await generateNoteMarkdown(payload);
  const built = buildNote(payload);
  const folder = resolveMemberFolder(built.member);
  const absDir = path.join(PT_DATA_DIR, folder);
  if (!fs.existsSync(absDir)) fs.mkdirSync(absDir, { recursive: true });
  const target = uniquePath(absDir, built.fileName);
  fs.writeFileSync(target, generated.markdown, 'utf8');

  const finalName = path.basename(target);
  const sync = maybeSyncToGitHub(folder, finalName, generated.markdown);

  return {
    savedPath: target,
    corrections: generated.corrections,
    sync,
    engine: generated.engine,
    gptError: generated.gptError || null,
  };
}

function deleteNote(payload) {
  ensurePtData();

  const normalized = normalizeMemberName(payload.member);
  const fileName = String(payload.fileName || '').trim();
  if (!normalized) throw new Error('회원 이름이 비어 있습니다.');
  if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
    throw new Error('삭제 파일명이 올바르지 않습니다.');
  }

  const folder = resolveMemberFolder(normalized);
  const absDir = path.join(PT_DATA_DIR, folder);
  const target = path.join(absDir, fileName);
  if (!target.startsWith(absDir)) throw new Error('삭제 경로가 올바르지 않습니다.');
  if (!fs.existsSync(target)) throw new Error('파일이 존재하지 않습니다.');

  fs.rmSync(target, { force: true });
  const sync = maybeDeleteFromGitHub(folder, fileName);

  return { deletedPath: target, sync };
}
function serveStatic(req, res) {
  let target = req.url === '/' ? '/index.html' : req.url;
  target = target.split('?')[0];
  const filePath = path.join(PUBLIC_DIR, target);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
    };

    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      sendJson(res, 200, { ok: true, ptDataDir: PT_DATA_DIR });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/system-info') {
      sendJson(res, 200, {
        host: HOST,
        port: PORT,
        localhost: `http://localhost:${PORT}`,
        lanUrls: getLanUrls(PORT),
      });
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/api/members')) {
      sendJson(res, 200, { members: getMembers() });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/members') {
      const body = await readBody(req);
      const normalized = normalizeMemberName(body.member);
      if (!normalized) return sendJson(res, 400, { error: '회원 이름을 입력하세요.' });

      ensurePtData();
      const memberDir = path.join(PT_DATA_DIR, normalized);
      if (!fs.existsSync(memberDir)) fs.mkdirSync(memberDir, { recursive: true });
      sendJson(res, 200, { ok: true, member: normalized, members: getMembers() });
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/exercises')) {
      const u = new URL(req.url, 'http://localhost');
      sendJson(res, 200, { items: getExerciseSuggestions(u.searchParams.get('q') || '') });
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/patterns')) {
      const u = new URL(req.url, 'http://localhost');
      const result = getLearnedPatterns(u.searchParams.get('q') || '');
      sendJson(res, 200, { patternKeys: PATTERN_KEYS, ...result });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/movement-db') {
      const db = readMovementDb();
      sendJson(res, 200, { count: (db.exercises || []).length, exercises: db.exercises || [] });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/patterns/learn') {
      const body = await readBody(req);
      const result = learnMovementPattern(body.exercise, body.pattern);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/notes')) {
      const u = new URL(req.url, 'http://localhost');
      const member = u.searchParams.get('member') || '';
      const q = u.searchParams.get('q') || '';
      const result = listMemberNotes(member, q);
      sendJson(res, 200, result);
      return;
    }
    if (req.method === 'POST' && req.url === '/api/preview') {
      const body = await readBody(req);
      const result = await previewNote(body);
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/save') {
      const body = await readBody(req);
      const result = await saveNote(body);
      sendJson(res, 200, {
        ok: true,
        savedPath: result.savedPath,
        corrections: result.corrections,
        sync: result.sync,
        engine: result.engine,
        gptError: result.gptError,
      });
      return;
    }

    if (req.method === 'DELETE' && req.url === '/api/notes') {
      const body = await readBody(req);
      const result = deleteNote(body);
      sendJson(res, 200, { ok: true, deletedPath: result.deletedPath, sync: result.sync });
      return;
    }
    serveStatic(req, res);
  } catch (err) {
    sendJson(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, HOST, () => {
  const localhostUrl = `http://localhost:${PORT}`;
  const lanUrls = getLanUrls(PORT);
  console.log('RARA PT webapp running');
  console.log(`- Local: ${localhostUrl}`);
  if (lanUrls.length > 0) {
    for (const u of lanUrls) console.log(`- Mobile (same Wi-Fi): ${u}`);
  } else {
    console.log('- Mobile URL not found. Check network connection.');
  }
});




















