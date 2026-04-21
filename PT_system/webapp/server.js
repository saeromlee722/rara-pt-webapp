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

const MEMBER_NAME_PATTERN = /^[^\d()]+ \(\d{4}\)$/;
let exerciseCatalogCache = null;

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
  return clean;
}

function isValidMemberDisplayName(member) {
  return MEMBER_NAME_PATTERN.test(String(member || '').trim());
}

function plainMember(member) {
  const clean = String(member || '').trim();
  const withoutPhone = clean.replace(/\s*\(\d{4}\)\s*$/, '').trim();
  return withoutPhone.endsWith('님') ? withoutPhone.slice(0, -1) : withoutPhone;
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

function writeMovementDb(db) {
  if (!fs.existsSync(LEARN_DIR)) fs.mkdirSync(LEARN_DIR, { recursive: true });
  const exercises = Array.isArray(db?.exercises) ? db.exercises : [];
  fs.writeFileSync(
    MOVEMENT_DB_PATH,
    JSON.stringify({ version: 1, exercises }, null, 2),
    'utf8'
  );
  invalidateExerciseCatalog();
}

function splitList(value) {
  if (Array.isArray(value)) {
    return value.map(x => String(x || '').trim()).filter(Boolean);
  }
  return String(value || '')
    .split(/\r?\n|,/)
    .map(x => x.trim())
    .filter(Boolean);
}

function movementToManageItem(ex) {
  const aliases = Array.isArray(ex.aliases) ? ex.aliases : [];
  return {
    name: String(ex.name || '').trim(),
    aliases,
    movementPattern: ex.movementPattern || 'general',
    exerciseRole: ex.exerciseRole || '',
    primaryTargetMuscles: Array.isArray(ex.primaryTargetMuscles) ? ex.primaryTargetMuscles : [],
    secondaryMuscles: Array.isArray(ex.secondaryMuscles) ? ex.secondaryMuscles : [],
    exercisePurpose: Array.isArray(ex.exercisePurpose) ? ex.exercisePurpose : [],
    coachingPoints: Array.isArray(ex.coachingPoints) ? ex.coachingPoints : [],
    sensationKeywords: Array.isArray(ex.sensationKeywords) ? ex.sensationKeywords : [],
    commonErrors: Array.isArray(ex.commonErrors) ? ex.commonErrors : [],
    correctionEffects: Array.isArray(ex.correctionEffects) ? ex.correctionEffects : [],
    routinePosition: ex.routinePosition || '',
    nextExerciseLinks: Array.isArray(ex.nextExerciseLinks) ? ex.nextExerciseLinks : [],
  };
}

function getMovementManageList(q = '') {
  const query = normalizeMovementKey(q);
  const db = readMovementDb();
  const learned = readLearnDb().overrides || {};
  const items = (db.exercises || [])
    .map(movementToManageItem)
    .filter(item => {
      if (!query) return true;
      const names = [item.name, ...item.aliases].map(normalizeMovementKey);
      return names.some(name => name.includes(query));
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'ko'));

  const learnedItems = Object.entries(learned)
    .map(([key, pattern]) => ({ key, pattern }))
    .filter(item => !query || item.key.includes(query))
    .sort((a, b) => a.key.localeCompare(b.key, 'ko'));

  return { items, learnedItems, patternKeys: PATTERN_KEYS };
}

function saveMovementMeta(payload) {
  const cleanName = String(payload.name || '').trim();
  if (!cleanName) throw new Error('운동명을 입력하세요.');

  const cleanPattern = String(payload.movementPattern || 'general').trim();
  if (!PATTERN_KEYS.includes(cleanPattern)) throw new Error('유효하지 않은 패턴입니다.');

  const db = readMovementDb();
  const exercises = Array.isArray(db.exercises) ? db.exercises : [];
  const key = normalizeMovementKey(cleanName);
  const existingIndex = exercises.findIndex(ex => {
    const names = [ex.name, ...(Array.isArray(ex.aliases) ? ex.aliases : [])];
    return names.some(name => normalizeMovementKey(name) === key);
  });

  const aliases = splitList(payload.aliases)
    .filter(alias => normalizeMovementKey(alias) && normalizeMovementKey(alias) !== key);
  const previous = existingIndex >= 0 ? exercises[existingIndex] : {};
  const mergedAliases = Array.from(new Set([
    ...(Array.isArray(previous.aliases) ? previous.aliases : []),
    ...aliases,
  ])).filter(alias => normalizeMovementKey(alias) !== key);

  const next = {
    ...previous,
    name: cleanName,
    aliases: mergedAliases,
    exerciseRole: String(payload.exerciseRole || previous.exerciseRole || '').trim(),
    movementPattern: cleanPattern,
    primaryTargetMuscles: splitList(payload.primaryTargetMuscles),
    secondaryMuscles: splitList(payload.secondaryMuscles),
    exercisePurpose: splitList(payload.exercisePurpose),
    coachingPoints: splitList(payload.coachingPoints),
    sensationKeywords: splitList(payload.sensationKeywords),
    commonErrors: splitList(payload.commonErrors),
    correctionEffects: splitList(payload.correctionEffects),
    routinePosition: String(payload.routinePosition || previous.routinePosition || '').trim(),
    nextExerciseLinks: splitList(payload.nextExerciseLinks),
  };

  if (existingIndex >= 0) exercises[existingIndex] = next;
  else exercises.push(next);

  writeMovementDb({ exercises });

  const learnDb = readLearnDb();
  learnDb.overrides[normalizeMovementKey(cleanName)] = cleanPattern;
  for (const alias of mergedAliases) {
    learnDb.overrides[normalizeMovementKey(alias)] = cleanPattern;
  }
  writeLearnDb(learnDb);

  return movementToManageItem(next);
}

function mergeMovementAlias(payload) {
  const source = String(payload.source || '').trim();
  const target = String(payload.target || '').trim();
  if (!source || !target) throw new Error('합칠 표기와 기준 운동명을 모두 입력하세요.');

  const targetKey = normalizeMovementKey(target);
  const sourceKey = normalizeMovementKey(source);
  if (!targetKey || !sourceKey) throw new Error('운동명이 올바르지 않습니다.');
  if (targetKey === sourceKey) throw new Error('같은 이름끼리는 합칠 수 없습니다.');

  const db = readMovementDb();
  const exercises = Array.isArray(db.exercises) ? db.exercises : [];
  let targetIndex = exercises.findIndex(ex => {
    const names = [ex.name, ...(Array.isArray(ex.aliases) ? ex.aliases : [])];
    return names.some(name => normalizeMovementKey(name) === targetKey);
  });

  const sourceIndex = exercises.findIndex(ex => {
    const names = [ex.name, ...(Array.isArray(ex.aliases) ? ex.aliases : [])];
    return names.some(name => normalizeMovementKey(name) === sourceKey);
  });

  if (targetIndex < 0) {
    exercises.push({
      name: target,
      aliases: [],
      movementPattern: getPattern(target),
      exercisePurpose: [],
      coachingPoints: [],
      sensationKeywords: [],
      commonErrors: [],
      nextExerciseLinks: [],
    });
    targetIndex = exercises.length - 1;
  }

  const targetMeta = exercises[targetIndex];
  const aliases = new Set(Array.isArray(targetMeta.aliases) ? targetMeta.aliases : []);
  aliases.add(source);

  if (sourceIndex >= 0 && sourceIndex !== targetIndex) {
    const sourceMeta = exercises[sourceIndex];
    aliases.add(sourceMeta.name);
    for (const alias of Array.isArray(sourceMeta.aliases) ? sourceMeta.aliases : []) aliases.add(alias);
    const listFields = [
      'primaryTargetMuscles',
      'secondaryMuscles',
      'exercisePurpose',
      'coachingPoints',
      'sensationKeywords',
      'commonErrors',
      'correctionEffects',
      'nextExerciseLinks',
    ];
    for (const field of listFields) {
      targetMeta[field] = Array.from(new Set([
        ...(Array.isArray(targetMeta[field]) ? targetMeta[field] : []),
        ...(Array.isArray(sourceMeta[field]) ? sourceMeta[field] : []),
      ]));
    }
    exercises.splice(sourceIndex, 1);
  }

  targetMeta.aliases = Array.from(aliases)
    .map(alias => String(alias || '').trim())
    .filter(alias => alias && normalizeMovementKey(alias) !== normalizeMovementKey(targetMeta.name));

  writeMovementDb({ exercises });

  const pattern = targetMeta.movementPattern || getPattern(targetMeta.name);
  const learnDb = readLearnDb();
  learnDb.overrides[sourceKey] = pattern;
  learnDb.overrides[targetKey] = pattern;
  writeLearnDb(learnDb);

  return movementToManageItem(targetMeta);
}

function findMovementMeta(exerciseName) {
  const item = normalizeExerciseItem(exerciseName);
  const key = normalizeMovementKey(item.name || item.displayName);
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

function isMachineTool(tool) {
  return String(tool || '').trim() === '머신';
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeExerciseBaseName(name, tool) {
  let clean = String(name || '').trim().replace(/\s+/g, ' ');
  const cleanTool = String(tool || '').trim();
  if (!clean || !cleanTool) return clean;

  if (isMachineTool(cleanTool)) {
    return clean
      .replace(/^머신\s+/, '')
      .replace(/\s*머신$/, '')
      .trim();
  }

  return clean
    .replace(new RegExp(`^${escapeRegExp(cleanTool)}\\s+`), '')
    .trim();
}

function formatExerciseDisplayName({ tool = '', name = '', target = '', variant = '' }) {
  const cleanTool = String(tool || '').trim();
  const baseName = normalizeExerciseBaseName(name, cleanTool);
  const details = [target, variant].filter(Boolean).join(', ');
  const label = isMachineTool(cleanTool)
    ? [baseName, cleanTool].filter(Boolean).join(' ')
    : [cleanTool, baseName].filter(Boolean).join(' ');
  return `${label}${details ? ` (${details})` : ''}`.trim();
}

function normalizeExerciseItem(item) {
  if (item && typeof item === 'object') {
    const rawName = String(item.name || item.exercise || item.label || item.displayName || '').trim();
    const tool = String(item.tool || item.equipment || '').trim();
    const target = String(item.target || item.primaryTarget || '').trim();
    const variant = String(item.variant || '').trim();
    const name = normalizeExerciseBaseName(rawName, tool);
    const displayName = formatExerciseDisplayName({ tool, name, target, variant }) || String(item.displayName || item.label || rawName).trim();
    return { name: name || displayName, tool, target, variant, displayName: displayName || name };
  }

  const displayName = String(item || '').trim();
  const m = displayName.match(/^(.+?)\s*\((.+)\)$/);
  return {
    name: m ? m[1].trim() : displayName,
    tool: '',
    target: m ? m[2].split(',')[0].trim() : '',
    variant: m ? m[2].split(',').slice(1).join(',').trim() : '',
    displayName,
  };
}

function normalizeExerciseItems(list) {
  return Array.isArray(list)
    ? list.map(normalizeExerciseItem).filter(item => item.displayName || item.name)
    : [];
}

function sanitizeExercises(list) {
  return normalizeExerciseItems(list).map(item => item.displayName || item.name).filter(Boolean);
}

function getMovementContext(exercises) {
  return normalizeExerciseItems(exercises).map(item => {
    const meta = findMovementMeta(item);
    const inferred = targetProfileAdjust(item);
    return {
      name: item.displayName || item.name,
      baseName: item.name,
      tool: item.tool,
      target: item.target,
      variant: item.variant,
      isLearned: !!meta,
      movementPattern: meta?.movementPattern || getPattern(item.displayName || item.name),
      purpose: Array.isArray(meta?.exercisePurpose) && meta.exercisePurpose.length ? meta.exercisePurpose : (inferred.purpose || []),
      coachingPoints: Array.isArray(meta?.coachingPoints) && meta.coachingPoints.length ? meta.coachingPoints : (inferred.points || []),
      sensationKeywords: Array.isArray(meta?.sensationKeywords) && meta.sensationKeywords.length ? meta.sensationKeywords : (inferred.keywords || []),
      commonErrors: Array.isArray(meta?.commonErrors) && meta.commonErrors.length ? meta.commonErrors : (inferred.signals || []),
      nextExerciseLinks: Array.isArray(meta?.nextExerciseLinks) && meta.nextExerciseLinks.length ? meta.nextExerciseLinks : (inferred.next ? [inferred.next] : []),
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

  const exerciseItems = normalizeExerciseItems(payload.exercises);
  const exercises = exerciseItems.map(item => item.displayName || item.name);
  const movementContext = getMovementContext(payload.exercises);
  const dateObj = parseDate(payload.date);
  const exactDateDisplay = `${dateObj.getFullYear()}.${String(dateObj.getMonth() + 1).padStart(2, '0')}.${String(dateObj.getDate()).padStart(2, '0')}`;
  const exactWeekday = getWeekdayKo(dateObj);
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
  '- 제목의 날짜와 요일은 사용자가 준 exactDateDisplay와 exactWeekday를 그대로 사용한다',
  '- 요일은 절대 추론하지 말고 exactWeekday만 그대로 쓴다',
  '- 하체/상체 맥락 절대 혼동 금지',
  '- 로우/풀다운 계열: 팔 개입 최소, 견갑 순서, 등 체감 중심',
  '- 불필요한 영어 혼용 최소화 (운동명 제외)',
  '- 각 블록 충분히 구체적으로 작성 (얕은 내용 금지)',
  '- 새 동작이라도 절대 일반론으로 채우지 말고 exerciseItems의 tool/target/variant와 movementContext를 근거로 구체화한다',
  '- movementContext.isLearned가 false인 동작은 새 동작으로 보고, 장비 특성 + 타겟 근육 + 움직임 패턴을 조합해 역할/목적/오류를 직접 추론한다',
  '- 같은 동작명이라도 target이 중둔근이면 골반 수평/외전 안정, 대둔근이면 고관절 신전/둔근 잠김으로 완전히 다르게 쓴다',
  '- tool이 머신이면 궤도 고정/패드 세팅/반동 제어, 케이블이면 장력 방향/시작 각도, 덤벨/바벨이면 중량 중심과 그립 안정성을 반영한다',
  '- 힙 익스텐션/hip extension은 고관절 신전과 둔근 운동이다. 트라이셉스 익스텐션처럼 해석하지 말고 손목/팔꿈치/삼두 오류를 넣지 않는다',
  '- 각 운동의 코칭 포인트는 최소 4개, 흔한 오류는 최소 3개를 운동별로 다르게 작성한다',
].join('\n');
  
  const userPayload = {
    date: payload.date,
    exactDateDisplay,
    exactWeekday,
    member: payload.member,
    exercises,
    exerciseItems,
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
  const all = getExerciseCatalog();
  const q = String(query || '').trim();
  if (!q) return all.slice(0, 100);
  return all.filter(x => x.includes(q)).slice(0, 30);
}

const CANONICAL_EXERCISE_NAMES = {
  '로우 로우머신': '로우 로우 머신',
  '원암 플레이트 로디드 미드로우 머신': '원암 플레이트 로디드 미드 로우 머신',
  '플레이트 로디드 미드로우 머신': '플레이트 로디드 미드 로우 머신',
  '시티드 미드로우 (케이블)': '시티드 미드 로우 (케이블)',
  '케이블 시티드 미드로우': '케이블 시티드 미드 로우',
  '아이솔레이션 케이블 미드로우': '아이솔레이션 케이블 미드 로우',
  '아이솔레이션 케이블 시티드로우': '아이솔레이션 케이블 시티드 로우',
  '힙익스텐션': '힙 익스텐션',
  '힙 쓰러스트 (밴드)': '밴드 힙쓰러스트',
  '스미스머신 힙쓰러스트': '스미스 머신 힙쓰러스트',
  '내로우그립 랫풀다운': '내로우 그립 랫풀다운',
  '케이블 로프 페이스 풀': '케이블 로프 페이스풀',
  '스미스 스모스쿼트': '스미스 스모 스쿼트',
  '덤벨 스모스쿼트': '덤벨 스모 스쿼트',
  '밴드 브이스쿼트머신': '밴드 브이스쿼트 머신',
  '프론트 숫더 프레스': '프론트 숄더 프레스',
  '리버스 펝덱 플라이': '리버스 펙덱 플라이',
  '아웃타이(중둔근 타겟)': '아웃타이 (중둔근 타겟)',
  '아웃타이 (힙 어브덕션 ; 중둔근 타겟)이': '아웃타이 (힙 어브덕션 ; 중둔근 타겟)',
  '펙덱 플라이': '펙덱 플라이 머신',
  '펙덱플라이 머신': '펙덱 플라이 머신',
  '디클라인 펙덱플라이 머신': '디클라인 펙덱 플라이 머신',
  '덤벨 스티프 데드리프트 (둔근 및 대퇴이두)': '덤벨 스티프 데드리프트',
  '덤벨 싱글 스티프 데드리프트': '덤벨 싱글레그 스티프 데드리프트',
  '머신 프론트 숄더 프레스': '프론트 숄더 프레스',
  '프론트 숄더 프레스 머신': '프론트 숄더 프레스',
  '머신 프론트 숄더 프레스 (어깨, 전거근 활성화)': '프론트 숄더 프레스 머신',
  '머신 레그 프레스': '레그 프레스 머신',
  '머신 레그 프레스 머신': '레그 프레스 머신',
  '머신 힙 쓰러스트': '힙쓰러스트 머신',
  '머신 힙 쓰러스트 머신': '힙쓰러스트 머신',
  '힙 쓰러스트 머신': '힙쓰러스트 머신',
  '머신 숄더 프레스': '숄더 프레스 머신',
  '머신 바이킹 숄더 프레스': '바이킹 숄더 프레스 머신',
  '머신 사이드 레터럴 레이즈': '사이드 레터럴 레이즈 머신',
  '머신 사이들 레터럴 레이즈': '사이드 레터럴 레이즈 머신',
  '사이들 레터럴 레이즈 머신': '사이드 레터럴 레이즈 머신',
  '머신 브이스쿼트': '브이스쿼트 머신',
  '머신 브이스쿼트 머신': '브이스쿼트 머신',
  '머신 시티드 레그컬': '시티드 레그컬 머신',
  '머신 펜듈럼 스쿼트': '펜듈럼 스쿼트 머신',
  '머신 하이 로우': '하이 로우 머신',
  '하이로우 머신': '하이 로우 머신',
  '머신 로우 로우': '로우 로우 머신',
  '언더그립 로우로우 머신': '언더그립 로우 로우 머신',
  '머신 랫 풀다운': '랫 풀다운 머신',
  '랫풀다운 머신': '랫 풀다운 머신',
  '머신 풀오버': '풀오버 머신',
  '머신 카프레이즈': '카프레이즈 머신',
  '머신 힙 익스텐션': '힙 익스텐션 머신',
  '머신 몬스터 글루트': '몬스터 글루트 머신',
  '머신 몬스터 글루트 머신': '몬스터 글루트 머신',
};

function canonicalExerciseName(name) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  const direct = CANONICAL_EXERCISE_NAMES[clean];
  if (direct) return direct;

  const m = clean.match(/^(.+?)\s*\((.+)\)$/);
  const base = m ? m[1].trim() : clean;
  const details = m ? m[2].trim() : '';
  const baseDirect = CANONICAL_EXERCISE_NAMES[base];
  if (baseDirect) return details ? `${baseDirect} (${details})` : baseDirect;

  if (/^머신\s+/.test(base)) {
    const machineBase = base
      .replace(/^머신\s+/, '')
      .replace(/\s*머신$/, '')
      .trim();
    const normalized = machineBase ? `${machineBase} 머신` : base;
    return details ? `${normalized} (${details})` : normalized;
  }

  return clean;
}

function getExerciseCatalog() {
  if (exerciseCatalogCache) return exerciseCatalogCache;

  const byKey = new Map();
  const addExerciseName = (name) => {
    const canonical = canonicalExerciseName(name);
    const key = normalizeMovementKey(canonical);
    if (!key) return;
    if (!byKey.has(key)) byKey.set(key, canonical);
  };

  for (const memberDir of getMembers()) {
    const absMember = path.join(PT_DATA_DIR, memberDir);
    for (const file of fs.readdirSync(absMember, { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith('.md')) {
        const raw = new Set();
        extractExercisesFromFile(path.join(absMember, file.name), raw);
        for (const name of raw) addExerciseName(name);
      }
    }
  }

  for (const ex of readMovementDb().exercises || []) {
    if (ex.name) addExerciseName(ex.name);
    for (const alias of Array.isArray(ex.aliases) ? ex.aliases : []) {
      if (alias) addExerciseName(alias);
    }
  }

  exerciseCatalogCache = Array.from(byKey.values()).sort((a, b) => a.localeCompare(b, 'ko'));
  return exerciseCatalogCache;
}

function invalidateExerciseCatalog() {
  exerciseCatalogCache = null;
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
  if (/힙\s*익스텐션|hip\s*extension/.test(ex)) return 'hipext';
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

function targetProfileAdjust(item) {
  const target = String(item?.target || '').trim();
  const tool = String(item?.tool || '').trim();
  const variant = String(item?.variant || '').trim();
  const labelBits = [tool, target, variant].filter(Boolean);
  const role = labelBits.length ? `${labelBits.join(' · ')} 기준으로 자극 위치를 분리해서 확인` : '';

  if (/중둔근/.test(target)) {
    return {
      role,
      purpose: ['골반 수평 유지', '무릎 외전 안정', '보행/싱글레그 안정 선활성'],
      points: ['골반이 들썩이지 않게 고정', '무릎을 벌린다보다 엉덩이 옆으로 밀어낸다', '상단 1초 정지 후 천천히 복귀', '허리 반동 없이 작은 범위부터 선명하게'],
      keywords: ['엉덩이 옆 타는 느낌', '골반이 잠기는 느낌', '무릎 바깥 힘 유지'],
      muscles: ['중둔근', '소둔근'],
      signals: ['TFL 과개입', '골반 회전', '허리 반동'],
      next: '중둔근 선활성 후 스쿼트/런지 중심선 안정으로 연결',
    };
  }

  if (/대둔근/.test(target)) {
    return {
      role,
      purpose: ['고관절 신전 감각 강화', '둔근 후면 수축 선명화', '허리 보상 감소'],
      points: ['골반을 살짝 말아 둔근으로 잠근다', '허리 꺾어서 올리지 않기', '발바닥 접지 유지', '끝지점에서 둔근 수축을 먼저 확인'],
      keywords: ['엉덩이 뒤쪽 묵직함', '상단 둔근 잠김', '허리 부담 없음'],
      muscles: ['대둔근', '햄스트링 보조'],
      signals: ['허리 과신전', '햄스트링 쥐남', '골반이 먼저 풀림'],
      next: '대둔근 수축 확인 후 힌지/스쿼트 메인 패턴으로 연결',
    };
  }

  if (/햄스트링/.test(target)) {
    return {
      role,
      purpose: ['후면 체인 텐션 형성', '골반 힌지 감각 강화', '무릎 각도 유지'],
      points: ['엉덩이를 뒤로 접어 햄스트링을 길게 만든다', '무릎 각도는 거의 고정', '허리 중립 유지', '올라올 때 엉덩이로 바닥을 민다'],
      keywords: ['허벅지 뒤 길어짐', '엉덩이 아래 묵직함', '허리 편안함'],
      muscles: ['햄스트링', '대둔근'],
      signals: ['허리 말림', '무릎 과굴곡', '반동으로 올라오기'],
      next: '햄스트링 텐션 유지 후 둔근 수축 운동으로 연결',
    };
  }

  if (/광배/.test(target)) {
    return {
      role,
      purpose: ['견갑 하강 선행', '광배 하부 체감 형성', '팔 개입 감소'],
      points: ['어깨를 먼저 아래로 내린다', '팔꿈치보다 겨드랑이를 닫는 느낌', '목 긴장 빼기', '당긴 뒤 갈비가 들리지 않게 유지'],
      keywords: ['겨드랑이 아래 당겨짐', '등 하부 단단함', '어깨 들림 감소'],
      muscles: ['광배근', '대원근'],
      signals: ['팔로만 당김', '어깨 으쓱', '허리 젖힘'],
      next: '광배 하강 감각을 로우/풀다운 패턴으로 연결',
    };
  }

  if (/가슴/.test(target)) {
    return {
      role,
      purpose: ['흉근 주도 수축', '어깨 앞쪽 부담 감소', '밀기 경로 안정'],
      points: ['견갑을 먼저 안정시킨다', '팔보다 가슴으로 밀거나 모은다', '갈비 들림 금지', '수축 지점에서 1초 확인'],
      keywords: ['가슴 중앙 압박', '어깨 앞 부담 없음', '가슴으로 미는 느낌'],
      muscles: ['대흉근', '전면 삼각근 보조'],
      signals: ['어깨 말림', '승모 과긴장', '허리 과신전'],
      next: '가슴 활성 후 프레스/플라이 품질 유지',
    };
  }

  return role ? { role } : {};
}

function mergeProfileData(base, adjust) {
  if (!adjust || Object.keys(adjust).length === 0) return base;
  return {
    ...base,
    role: adjust.role || base.role || '',
    purpose: Array.isArray(adjust.purpose) && adjust.purpose.length ? adjust.purpose.join(' + ') : base.purpose,
    points: Array.isArray(adjust.points) && adjust.points.length ? adjust.points : base.points,
    keywords: Array.isArray(adjust.keywords) && adjust.keywords.length ? adjust.keywords : base.keywords,
    muscles: Array.isArray(adjust.muscles) && adjust.muscles.length ? adjust.muscles : base.muscles,
    feelings: Array.isArray(adjust.keywords) && adjust.keywords.length ? adjust.keywords : base.feelings,
    signals: Array.isArray(adjust.signals) && adjust.signals.length ? adjust.signals : base.signals,
    next: adjust.next || base.next,
  };
}

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

  const exerciseItems = normalizeExerciseItems(payload.exercises);
  const exercises = exerciseItems.map(item => item.displayName || item.name).filter(Boolean);
  if (!member) throw new Error('회원 이름이 비어 있습니다.');
  if (exercises.length === 0) throw new Error('운동 목록이 비어 있습니다.');

  const profiles = exerciseItems.map(item => {
    const name = item.displayName || item.name;
    const pattern = getPattern(name);
    const base = mergeProfileData(PROFILES[pattern] || PROFILES.general, targetProfileAdjust(item));
    const meta = findMovementMeta(item);

    if (!meta) return { name, pattern, hasMeta: false, data: base };

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
        role: meta.exerciseRole || base.role || '',
        tag: metaTag,
        purpose: metaPurpose,
        points: metaPoints,
        keywords: metaKeywords,
        muscles: metaMuscles.length > 0 ? metaMuscles : base.muscles,
        feelings: metaKeywords,
        signals: metaSignals,
        next: metaNext,
      },
      hasMeta: true,
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
    if (p.data.role) lines.push(`- **역할**  `, `    ${p.data.role}`, '    ');
    lines.push('- **목적**  ', `    ${p.data.purpose}`, '    ');
    lines.push('- **포인트**', '    ');
    points.forEach(pt => lines.push(`    - ${pt}`, '        '));
    lines.push('- **🔑 체감 키워드**', '    ');
    keywords.forEach(kw => lines.push(`    - ${kw}`, '        '));
    lines.push('- **흔한 오류**', '    ');
    uniq([...p.data.signals, ...adj.extraSignals]).slice(0, 3).forEach(signal => lines.push(`    - ${signal}`, '        '));
    lines.push('- **다음 연결**  ', `    ${p.data.next}`, '    ');
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
  const dirs = getMembers();

  const numbered = dirs.find(name => plainMember(name) === plain && /\(\d{4}\)\s*$/.test(name));
  if (numbered) return numbered;

  const candidates = [member, plain, `${plain}님`];
  for (const c of candidates) {
    const p = path.join(PT_DATA_DIR, c);
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return c;
  }

  return plain;
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

function getNoteContent(member, fileName) {
  ensurePtData();

  const normalized = normalizeMemberName(member);
  const safeFileName = String(fileName || '').trim();
  if (!normalized) throw new Error('회원 이름이 비어 있습니다.');
  if (!safeFileName || safeFileName.includes('/') || safeFileName.includes('\\')) {
    throw new Error('파일명이 올바르지 않습니다.');
  }

  const folder = resolveMemberFolder(normalized);
  const absDir = path.join(PT_DATA_DIR, folder);
  const target = path.join(absDir, safeFileName);
  if (!target.startsWith(absDir)) throw new Error('조회 경로가 올바르지 않습니다.');
  if (!fs.existsSync(target)) throw new Error('파일이 존재하지 않습니다.');

  return {
    member: folder,
    fileName: safeFileName,
    content: fs.readFileSync(target, 'utf8'),
    fullPath: target,
  };
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
  invalidateExerciseCatalog();

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
  invalidateExerciseCatalog();
  const sync = maybeDeleteFromGitHub(folder, fileName);

  return { deletedPath: target, sync };
}

function updateNote(payload) {
  ensurePtData();

  const normalized = normalizeMemberName(payload.member);
  const fileName = String(payload.fileName || '').trim();
  if (!normalized) throw new Error('회원 이름이 비어 있습니다.');
  if (!fileName || fileName.includes('/') || fileName.includes('\\')) {
    throw new Error('수정 파일명이 올바르지 않습니다.');
  }

  const folder = resolveMemberFolder(normalized);
  const absDir = path.join(PT_DATA_DIR, folder);
  const target = path.join(absDir, fileName);
  if (!target.startsWith(absDir)) throw new Error('수정 경로가 올바르지 않습니다.');
  if (!fs.existsSync(target)) throw new Error('파일이 존재하지 않습니다.');

  const checked = spellCheckMarkdown(String(payload.content || ''));
  fs.writeFileSync(target, checked.text, 'utf8');
  invalidateExerciseCatalog();
  const sync = maybeSyncToGitHub(folder, fileName, checked.text);

  return {
    savedPath: target,
    corrections: checked.corrections,
    sync,
  };
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
      if (!isValidMemberDisplayName(normalized)) {
        return sendJson(res, 400, { error: '회원 형식은 이름 (1234) 이어야 합니다.' });
      }

      ensurePtData();
      const memberDir = path.join(PT_DATA_DIR, normalized);
      if (!fs.existsSync(memberDir)) fs.mkdirSync(memberDir, { recursive: true });
      sendJson(res, 200, { ok: true, member: normalized, members: getMembers() });
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/exercises')) {
      const u = new URL(req.url, 'http://localhost');
      const returnAll = u.searchParams.get('all') === '1';
      sendJson(res, 200, {
        items: returnAll ? getExerciseCatalog() : getExerciseSuggestions(u.searchParams.get('q') || '')
      });
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/patterns')) {
      const u = new URL(req.url, 'http://localhost');
      const result = getLearnedPatterns(u.searchParams.get('q') || '');
      sendJson(res, 200, { patternKeys: PATTERN_KEYS, ...result });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/patterns/learn') {
      const body = await readBody(req);
      const result = learnMovementPattern(body.exercise, body.pattern);
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (req.method === 'GET' && req.url === '/api/movement-db') {
      const db = readMovementDb();
      sendJson(res, 200, { count: (db.exercises || []).length, exercises: db.exercises || [] });
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/movements/manage')) {
      const u = new URL(req.url, 'http://localhost');
      sendJson(res, 200, getMovementManageList(u.searchParams.get('q') || ''));
      return;
    }

    if (req.method === 'POST' && req.url === '/api/movements/manage') {
      const body = await readBody(req);
      const item = saveMovementMeta(body);
      sendJson(res, 200, { ok: true, item });
      return;
    }

    if (req.method === 'POST' && req.url === '/api/movements/merge') {
      const body = await readBody(req);
      const item = mergeMovementAlias(body);
      sendJson(res, 200, { ok: true, item });
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/api/notes/content')) {
      const u = new URL(req.url, 'http://localhost');
      const result = getNoteContent(u.searchParams.get('member') || '', u.searchParams.get('fileName') || '');
      sendJson(res, 200, result);
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

    if (req.method === 'PUT' && req.url === '/api/notes') {
      const body = await readBody(req);
      const result = updateNote(body);
      sendJson(res, 200, {
        ok: true,
        savedPath: result.savedPath,
        corrections: result.corrections,
        sync: result.sync,
      });
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























