const state = {
  members: [],
  exercises: [],
  notes: [],
  exerciseCatalog: [],
  movements: [],
  learnedMovements: [],
};

let exerciseSuggestTimer = null;

const dateInput = document.getElementById('dateInput');
const memberSelect = document.getElementById('memberSelect');
const newMemberInput = document.getElementById('newMemberInput');
const addMemberBtn = document.getElementById('addMemberBtn');
const exerciseInput = document.getElementById('exerciseInput');
const exerciseToolSelect = document.getElementById('exerciseToolSelect');
const exerciseTargetSelect = document.getElementById('exerciseTargetSelect');
const exerciseVariantInput = document.getElementById('exerciseVariantInput');
const exerciseList = document.getElementById('exerciseList');
const addExerciseBtn = document.getElementById('addExerciseBtn');
const exerciseChips = document.getElementById('exerciseChips');
const specialInput = document.getElementById('specialInput');
const previewBtn = document.getElementById('previewBtn');
const saveBtn = document.getElementById('saveBtn');
const useGptToggle = document.getElementById('useGptToggle');
const previewBox = document.getElementById('previewBox');
const statusText = document.getElementById('statusText');
const networkInfo = document.getElementById('networkInfo');
const noteSearchInput = document.getElementById('noteSearchInput');
const loadNotesBtn = document.getElementById('loadNotesBtn');
const noteList = document.getElementById('noteList');
const noteEditPanel = document.getElementById('noteEditPanel');
const noteEditFileName = document.getElementById('noteEditFileName');
const noteEditTextarea = document.getElementById('noteEditTextarea');
const noteEditSaveBtn = document.getElementById('noteEditSaveBtn');
const noteEditCancelBtn = document.getElementById('noteEditCancelBtn');
const learnExerciseInput = document.getElementById('learnExerciseInput');
const learnPatternSelect = document.getElementById('learnPatternSelect');
const learnSaveBtn = document.getElementById('learnSaveBtn');
const learnStatus = document.getElementById('learnStatus');
const movementSearchInput = document.getElementById('movementSearchInput');
const movementLoadBtn = document.getElementById('movementLoadBtn');
const movementSelect = document.getElementById('movementSelect');
const movementNameInput = document.getElementById('movementNameInput');
const movementAliasesInput = document.getElementById('movementAliasesInput');
const movementPatternSelect = document.getElementById('movementPatternSelect');
const movementRoleInput = document.getElementById('movementRoleInput');
const movementPurposeInput = document.getElementById('movementPurposeInput');
const movementCoachingInput = document.getElementById('movementCoachingInput');
const movementSensationInput = document.getElementById('movementSensationInput');
const movementErrorsInput = document.getElementById('movementErrorsInput');
const movementNextInput = document.getElementById('movementNextInput');
const movementSaveBtn = document.getElementById('movementSaveBtn');
const movementMergeBtn = document.getElementById('movementMergeBtn');
const movementStatus = document.getElementById('movementStatus');

const MEMBER_NAME_PATTERN = /^[^\d()]+ \(\d{4}\)$/;

function setToday() {
  const now = new Date();
  const tzOffsetMs = now.getTimezoneOffset() * 60 * 1000;
  const localISO = new Date(now - tzOffsetMs).toISOString().slice(0, 10);
  dateInput.value = localISO;
}

const patternLabels = {
  hinge: '힙힌지',
  squat: '스쿼트/하체',
  split: '런지/한쪽지지',
  hipext: '힙신전/둔근',
  abduction: '외전/중둔근',
  adduction: '내전/중심선',
  pushh: '수평밀기(가슴)',
  pushv: '수직밀기(어깨)',
  pullh: '수평당기기(로우)',
  pullv: '수직당기기(랫)',
  scap: '견갑안정',
  arm: '팔고립',
  core: '코어',
  general: '기타',
};


async function loadSystemInfo() {
  try {
    const data = await api('/api/system-info');
    const lines = [];
    if (Array.isArray(data.lanUrls) && data.lanUrls.length > 0) {
      lines.push(`휴대폰 접속: ${data.lanUrls[0]}`);
      lines.push('같은 Wi-Fi에서 열어줘');
    } else {
      lines.push('휴대폰 접속 URL을 찾지 못함');
    }
    networkInfo.textContent = lines.join(' | ');
  } catch {
    networkInfo.textContent = '';
  }
}
async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '요청 실패');
  return data;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInline(text) {
  let out = escapeHtml(text);
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/`(.+?)`/g, '<code>$1</code>');
  return out;
}

function renderMarkdown(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const html = [];
  let inUl = false;

  const closeUl = () => {
    if (inUl) {
      html.push('</ul>');
      inUl = false;
    }
  };

  for (const raw of lines) {
    const line = raw ?? '';
    const trimmed = line.trim();

    if (!trimmed) {
      closeUl();
      html.push('<div class="md-gap"></div>');
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      closeUl();
      html.push('<hr />');
      continue;
    }

    let m = trimmed.match(/^###\s+(.+)$/);
    if (m) {
      closeUl();
      html.push(`<h3>${formatInline(m[1])}</h3>`);
      continue;
    }

    m = trimmed.match(/^##\s+(.+)$/);
    if (m) {
      closeUl();
      html.push(`<h2>${formatInline(m[1])}</h2>`);
      continue;
    }

    m = trimmed.match(/^#\s+(.+)$/);
    if (m) {
      closeUl();
      html.push(`<h1>${formatInline(m[1])}</h1>`);
      continue;
    }

    m = trimmed.match(/^[-*]\s+(.+)$/);
    if (m) {
      if (!inUl) {
        html.push('<ul>');
        inUl = true;
      }
      html.push(`<li>${formatInline(m[1])}</li>`);
      continue;
    }

    closeUl();

    if (trimmed.startsWith('→')) {
      html.push(`<p class="md-arrow">${formatInline(trimmed)}</p>`);
      continue;
    }

    if (trimmed.startsWith('👉')) {
      html.push(`<p class="md-point">${formatInline(trimmed)}</p>`);
      continue;
    }

    if (/^_\(.+\)_$/.test(trimmed)) {
      html.push(`<p class="md-tag">${formatInline(trimmed.slice(2, -2))}</p>`);
      continue;
    }

    html.push(`<p>${formatInline(trimmed)}</p>`);
  }

  closeUl();
  return html.join('\n');
}

function renderMembers() {
  memberSelect.innerHTML = '';
  state.members.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    memberSelect.appendChild(opt);
  });
}

function renderExerciseList(items) {
  exerciseList.innerHTML = '';
  items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item;
    exerciseList.appendChild(opt);
  });
}

function exerciseDisplayName(item) {
  if (typeof item === 'string') return item;
  return item?.displayName || item?.label || item?.name || '';
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
      .replace(/머신/g, ' ')
      .replace(/\s+/g, ' ')
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

const EQUIPMENT_WORDS = ['맨몸', '덤벨', '바벨', '케틀벨', '케이블', '머신', '밴드', '스미스', '플레이트'];
const NON_MACHINE_TOOLS = EQUIPMENT_WORDS.filter(tool => tool !== '머신');

function splitExerciseDetails(label) {
  const clean = String(label || '').trim();
  const match = clean.match(/^(.+?)\s*\((.+)\)$/);
  return {
    base: match ? match[1].trim() : clean,
    details: match ? match[2].trim() : '',
  };
}

function normalizeSuggestionBaseName(base) {
  return String(base || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/레그프레스/g, '레그 프레스')
    .replace(/랫풀다운/g, '랫 풀다운')
    .replace(/하이로우/g, '하이 로우')
    .replace(/로우로우/g, '로우 로우')
    .replace(/미드로우/g, '미드 로우')
    .replace(/힙\s*쓰러스트/g, '힙쓰러스트')
    .replace(/힙익스텐션/g, '힙 익스텐션')
    .replace(/펙덱플라이/g, '펙덱 플라이')
    .replace(/사이들 레터럴/g, '사이드 레터럴')
    .replace(/굿모닝\s*엑사사이즈/g, '굿모닝');
}

const TARGET_SUGGESTION_HINTS = {
  중둔근: ['아웃타이', '어브덕', '어브덕션', '몬스터 글루트', '글루트 어브덕', '힙 어브덕', '크램쉘', '사이드 스텝', '밴드 워크'],
  대둔근: ['힙쓰러스트', '힙 익스텐션', '킥백', '글루트', '브릿지', '굿모닝', '스쿼트', '레그 프레스', '브이스쿼트', '런지', '스플릿', '스텝업', '펜듈럼'],
  '햄스트링+둔근': ['힙쓰러스트', '힙 익스텐션', '스티프', '데드리프트', '굿모닝', '레그 컬', '레그컬', '킥백', '브릿지', '레그 프레스', '브이스쿼트'],
  햄스트링: ['스티프', '데드리프트', '굿모닝', '레그 컬', '레그컬', '힙 익스텐션', '백 익스텐션', '레그 프레스', '브이스쿼트'],
  대퇴사두: ['레그 프레스', '레그 익스텐션', '스쿼트', '브이스쿼트', '핵스쿼트', '펜듈럼', '런지', '스플릿', '스텝업'],
  '하체 전체': ['레그 프레스', '스쿼트', '브이스쿼트', '핵스쿼트', '펜듈럼', '런지', '스플릿', '스텝업', '데드리프트', '굿모닝', '힙쓰러스트', '레그 컬', '레그컬'],
  내전근: ['이너타이', '내전', '어덕션', '어덕터', '와이드 스쿼트', '요가블럭'],
  광배: ['랫 풀다운', '풀다운', '암풀다운', '로터리', '하이 로우', '풀오버', '맥그립', '로우'],
  '등 중앙': ['로우', '하이 로우', '미드 로우', '로우 로우', '시티드 로우', '벤트오버', '페이스풀', '리버스 쉬러그'],
  '중부 승모근': ['로우', '하이 로우', '미드 로우', '로우 로우', '시티드 로우', '벤트오버', '페이스풀', '리버스 쉬러그', '리어델트'],
  '하부 승모근': ['리버스 쉬러그', '쉬러그', '페이스풀', 'Y레이즈', '와이 레이즈', '풀다운', '로우', '숄더 프레스'],
  가슴: ['체스트', '벤치 프레스', '체스트 프레스', '펙덱', '플라이', '푸쉬업', '딥스'],
  어깨: ['숄더', '프레스', '레터럴', '레이즈', '리어델트', '비하인드', '페이스풀', '업라이트'],
  전거근: ['전거근', '푸쉬업', '월슬라이드', '월 슬라이드', '숄더 프레스', '프론트 숄더', 'Y레이즈', '와이 레이즈'],
  팔: ['이두', '삼두', '바이셉', '트라이셉', '암 컬', '해머 컬', '로프 푸쉬다운', '푸쉬다운', '트라이셉 익스텐션'],
  코어: ['플랭크', '데드버그', '크런치', '코어', '팔로프', '행잉', '레그레이즈'],
  '전신 안정': ['플랭크', '데드버그', '팔로프', '캐리', '스쿼트', '런지', '스텝업', '푸쉬업'],
};

function normalizeSuggestionSearchText(value) {
  return normalizeSuggestionBaseName(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function matchesSelectedTarget(label, selectedTarget) {
  const target = String(selectedTarget || '').trim();
  if (!target) return true;

  const parsed = splitExerciseDetails(label);
  const base = normalizeSuggestionSearchText(parsed.base);
  const details = normalizeSuggestionSearchText(parsed.details);
  const hints = TARGET_SUGGESTION_HINTS[target] || [target];

  if (details.includes(target)) return true;
  return hints.some(hint => base.includes(normalizeSuggestionSearchText(hint)));
}

function hasExplicitNonMachineTool(label) {
  const { base } = splitExerciseDetails(label);
  return NON_MACHINE_TOOLS.some(tool => base.startsWith(`${tool} `));
}

function suggestionForSelectedTool(label, selectedTool) {
  const cleanTool = String(selectedTool || '').trim();
  const cleanLabel = String(label || '').trim();
  if (!cleanTool) return cleanLabel;

  const parsed = splitExerciseDetails(cleanLabel);
  const base = normalizeSuggestionBaseName(parsed.base);
  const details = parsed.details;
  if (isMachineTool(cleanTool)) {
    if (hasExplicitNonMachineTool(cleanLabel)) return '';
    const machineName = formatExerciseDisplayName({ tool: cleanTool, name: base });
    return details ? `${machineName} (${details})` : machineName;
  }

  if (base.includes('머신')) return '';
  const toolName = formatExerciseDisplayName({ tool: cleanTool, name: base });
  return details ? `${toolName} (${details})` : toolName;
}

function buildExerciseItem() {
  const rawName = exerciseInput.value.trim();
  const tool = exerciseToolSelect.value.trim();
  const target = exerciseTargetSelect.value.trim();
  const variant = exerciseVariantInput.value.trim();
  if (!rawName) return null;

  const name = normalizeExerciseBaseName(rawName, tool);
  const displayName = formatExerciseDisplayName({ tool, name, target, variant });
  return { tool, name, target, variant, displayName };
}

function renderChips() {
  exerciseChips.innerHTML = '';
  state.exercises.forEach((item, idx) => {
    const name = exerciseDisplayName(item);
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'chip-label';
    label.textContent = name;
    const edit = document.createElement('button');
    edit.className = 'chip-edit';
    edit.type = 'button';
    edit.textContent = '수정';
    edit.addEventListener('click', () => {
      const next = window.prompt('운동 이름 수정', name);
      if (!next) return;
      const trimmed = next.trim();
      if (!trimmed) return;
      state.exercises[idx] = { name: trimmed, displayName: trimmed };
      renderChips();
      movementSearchInput.value = trimmed;
      movementNameInput.value = trimmed;
    });
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'x';
    del.addEventListener('click', () => {
      state.exercises.splice(idx, 1);
      renderChips();
    });
    li.appendChild(label);
    li.appendChild(edit);
    li.appendChild(del);
    exerciseChips.appendChild(li);
  });
}

function renderNoteList() {
  noteList.innerHTML = '';
  if (!state.notes.length) {
    const li = document.createElement('li');
    li.className = 'note-empty';
    li.textContent = '조회된 노트가 없습니다.';
    noteList.appendChild(li);
    return;
  }

  state.notes.forEach(note => {
    const li = document.createElement('li');

    const file = document.createElement('div');
    file.className = 'note-file';
    file.textContent = note.fileName;

    const actions = document.createElement('div');
    actions.className = 'note-item-actions';

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'ghost';
    edit.textContent = '수정';
    edit.addEventListener('click', async () => {
      await openEditNote(note.fileName);
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'danger';
    del.textContent = '삭제';
    del.addEventListener('click', async () => {
      const ok = confirm('정말 삭제할까?\n' + note.fileName);
      if (!ok) return;
      await deleteNote(note.fileName);
    });

    actions.appendChild(edit);
    actions.appendChild(del);
    li.appendChild(file);
    li.appendChild(actions);
    noteList.appendChild(li);
  });
}

function closeEditPanel() {
  noteEditPanel.classList.add('hidden');
  noteEditFileName.textContent = '선택된 파일 없음';
  noteEditTextarea.value = '';
  state.editingFileName = null;
}

async function openEditNote(fileName) {
  try {
    setStatus('노트 불러오는 중...');
    const member = memberSelect.value;
    const data = await api(`/api/notes/content?member=${encodeURIComponent(member)}&fileName=${encodeURIComponent(fileName)}`);
    noteEditPanel.classList.remove('hidden');
    noteEditFileName.textContent = data.fileName;
    noteEditTextarea.value = data.content || '';
    state.editingFileName = data.fileName;
    setStatus(`수정 열림: ${data.fileName}`);
  } catch (e) {
    setStatus(e.message, true);
  }
}

async function loadNotes() {
  const member = memberSelect.value;
  if (!member) {
    state.notes = [];
    renderNoteList();
    return;
  }

  const q = noteSearchInput.value.trim();
  const data = await api(`/api/notes?member=${encodeURIComponent(member)}&q=${encodeURIComponent(q)}`);
  state.notes = data.notes || [];
  renderNoteList();
}

async function deleteNote(fileName) {
  try {
    setStatus('삭제 중...');
    const data = await api('/api/notes', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member: memberSelect.value, fileName }),
    });
    const syncMsg = data.sync && data.sync.synced ? ` | sync:${data.sync.reason}` : (data.sync ? ` | sync_fail:${data.sync.reason}` : '');
    if (syncFailed(data.sync)) {
      setStatus(syncFailureMessage('삭제', data.sync), true);
      await loadNotes();
      return;
    }
    setStatus(`삭제 완료: ${data.deletedPath}${syncMsg}`);
    if (state.editingFileName === fileName) closeEditPanel();
    await loadNotes();
  } catch (e) {
    setStatus(e.message, true);
  }
}

async function saveEditedNote() {
  try {
    if (!state.editingFileName) {
      setStatus('수정할 노트를 먼저 선택해줘.', true);
      return;
    }
    setStatus('수정 저장 중...');
    const data = await api('/api/notes', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        member: memberSelect.value,
        fileName: state.editingFileName,
        content: noteEditTextarea.value,
      }),
    });
    const syncMsg = data.sync && data.sync.synced ? ` | sync:${data.sync.reason}` : (data.sync ? ` | sync_fail:${data.sync.reason}` : '');
    const correctionMsg = Array.isArray(data.corrections) && data.corrections.length
      ? ` | 교정:${data.corrections.join(', ')}`
      : '';
    if (syncFailed(data.sync)) {
      setStatus(syncFailureMessage('수정 저장', data.sync), true);
      await loadNotes();
      return;
    }
    setStatus(`수정 저장 완료: ${data.savedPath}${syncMsg}${correctionMsg}`);
    await loadNotes();
    closeEditPanel();
  } catch (e) {
    setStatus(e.message, true);
  }
}
async function loadMembers() {
  const data = await api('/api/members');
  state.members = data.members;
  renderMembers();
}

async function loadExerciseSuggestions(q = '') {
  if (!state.exerciseCatalog.length) {
    const data = await api('/api/exercises?all=1');
    state.exerciseCatalog = Array.isArray(data.items) ? data.items : [];
  }
  renderExerciseList(filterExerciseSuggestions(q));
}

function filterExerciseSuggestions(q = '') {
  const query = String(q || '').trim();
  const selectedTool = exerciseToolSelect.value.trim();
  const selectedTarget = exerciseTargetSelect.value.trim();
  const seen = new Set();
  const normalizedQuery = normalizeSuggestionSearchText(query);
  const all = state.exerciseCatalog
    .map(item => suggestionForSelectedTool(item, selectedTool))
    .filter(Boolean)
    .filter(item => matchesSelectedTarget(item, selectedTarget))
    .filter(item => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    });

  if (!query) return all.slice(0, 20);
  const limit = query.length >= 2 ? 20 : 15;
  return all
    .filter(item => item.includes(query) || normalizeSuggestionSearchText(item).includes(normalizedQuery))
    .slice(0, limit);
}

function addExercise() {
  const item = buildExerciseItem();
  if (!item) return;
  const displayName = exerciseDisplayName(item);
  if (!state.exercises.some(existing => exerciseDisplayName(existing) === displayName)) {
    state.exercises.push(item);
  }
  movementSearchInput.value = item.name;
  if (!movementNameInput.value.trim()) movementNameInput.value = item.name;
  exerciseInput.value = '';
  exerciseVariantInput.value = '';
  renderChips();
}

function payload() {
  return {
    date: dateInput.value,
    member: memberSelect.value,
    exercises: state.exercises,
    special: specialInput.value.trim(),
    useGpt: !!useGptToggle.checked,
  };
}

function resetComposer() {
  state.exercises = [];
  renderChips();
  exerciseInput.value = '';
  specialInput.value = '';
  previewBox.innerHTML = '';
  setToday();
}

function setStatus(text, isError = false) {
  statusText.textContent = text;
  statusText.style.color = isError ? '#b91c1c' : '#56635c';
}

function syncFailed(sync) {
  return !!(sync && sync.enabled !== false && sync.synced === false);
}

function syncFailureMessage(action, sync) {
  const reason = sync && sync.reason ? ` 사유: ${sync.reason}` : '';
  return `GitHub 미반영: ${action}은 Render 임시 저장소에만 반영됐을 수 있어. 새로고침/재배포 전에 내용을 보존해줘.${reason}`;
}

function setLearnStatus(text, isError = false) {
  learnStatus.textContent = text;
  learnStatus.style.color = isError ? '#b91c1c' : '#56635c';
}

function setMovementStatus(text, isError = false) {
  movementStatus.textContent = text;
  movementStatus.style.color = isError ? '#b91c1c' : '#56635c';
}

function listToText(value) {
  return Array.isArray(value) ? value.join(', ') : '';
}

function fillMovementForm(item) {
  if (!item) {
    const seed = movementSearchInput.value.trim();
    movementNameInput.value = seed;
    movementAliasesInput.value = '';
    movementRoleInput.value = '';
    movementPurposeInput.value = '';
    movementCoachingInput.value = '';
    movementSensationInput.value = '';
    movementErrorsInput.value = '';
    movementNextInput.value = '';
    if (movementPatternSelect.options.length) movementPatternSelect.value = 'general';
    return;
  }

  movementNameInput.value = item.name || '';
  movementAliasesInput.value = listToText(item.aliases);
  movementPatternSelect.value = item.movementPattern || 'general';
  movementRoleInput.value = item.exerciseRole || '';
  movementPurposeInput.value = listToText(item.exercisePurpose);
  movementCoachingInput.value = listToText(item.coachingPoints);
  movementSensationInput.value = listToText(item.sensationKeywords);
  movementErrorsInput.value = listToText(item.commonErrors);
  movementNextInput.value = listToText(item.nextExerciseLinks);
}

function renderMovementSelect() {
  movementSelect.innerHTML = '';

  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = state.movements.length ? '동작 선택 또는 새로 입력' : '등록된 DB 동작 없음';
  movementSelect.appendChild(blank);

  state.movements.forEach((item, idx) => {
    const opt = document.createElement('option');
    opt.value = String(idx);
    const aliases = Array.isArray(item.aliases) && item.aliases.length ? ` / ${item.aliases.join(', ')}` : '';
    opt.textContent = `${item.name}${aliases}`;
    movementSelect.appendChild(opt);
  });
}

async function loadMovements() {
  const q = movementSearchInput.value.trim();
  const data = await api(`/api/movements/manage?q=${encodeURIComponent(q)}`);
  state.movements = Array.isArray(data.items) ? data.items : [];
  state.learnedMovements = Array.isArray(data.learnedItems) ? data.learnedItems : [];
  renderMovementSelect();

  const exact = state.movements.find(item => {
    const names = [item.name, ...(Array.isArray(item.aliases) ? item.aliases : [])];
    return q && names.some(name => name === q);
  });
  fillMovementForm(exact || null);

  const learnedMsg = state.learnedMovements.length ? `, 학습 ${state.learnedMovements.length}개` : '';
  setMovementStatus(`DB 동작 ${state.movements.length}개${learnedMsg} 불러옴`);
}

function movementPayload() {
  return {
    name: movementNameInput.value.trim(),
    aliases: movementAliasesInput.value,
    movementPattern: movementPatternSelect.value,
    exerciseRole: movementRoleInput.value,
    exercisePurpose: movementPurposeInput.value,
    coachingPoints: movementCoachingInput.value,
    sensationKeywords: movementSensationInput.value,
    commonErrors: movementErrorsInput.value,
    nextExerciseLinks: movementNextInput.value,
  };
}

async function saveMovement() {
  const body = movementPayload();
  if (!body.name) {
    setMovementStatus('기준 운동명을 입력해줘.', true);
    movementNameInput.focus();
    return;
  }

  const data = await api('/api/movements/manage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  state.exerciseCatalog = [];
  setMovementStatus(`저장 완료: ${data.item.name}`);
  await loadMovements();
  await loadExerciseSuggestions(exerciseInput.value);
}

async function mergeMovement() {
  const source = movementSearchInput.value.trim();
  const target = movementNameInput.value.trim();
  if (!source || !target) {
    setMovementStatus('합칠 표기와 기준 운동명을 모두 입력해줘.', true);
    return;
  }

  const data = await api('/api/movements/merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source, target }),
  });
  state.exerciseCatalog = [];
  setMovementStatus(`합치기 완료: ${source} -> ${data.item.name}`);
  await loadMovements();
  await loadExerciseSuggestions(exerciseInput.value);
}

function isValidMemberDisplayName(name) {
  return MEMBER_NAME_PATTERN.test(String(name || '').trim());
}

async function loadPatternKeys() {
  const data = await api('/api/patterns');
  learnPatternSelect.innerHTML = '';
  movementPatternSelect.innerHTML = '';
  (data.patternKeys || []).forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = patternLabels[key] || key;
    learnPatternSelect.appendChild(opt);

    const movementOpt = document.createElement('option');
    movementOpt.value = key;
    movementOpt.textContent = patternLabels[key] || key;
    movementPatternSelect.appendChild(movementOpt);
  });
}

async function saveLearnPattern() {
  const exercise = learnExerciseInput.value.trim() || exerciseInput.value.trim();
  const pattern = learnPatternSelect.value;
  if (!exercise) {
    setLearnStatus('운동명을 입력해줘.', true);
    return;
  }

  const data = await api('/api/patterns/learn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exercise, pattern }),
  });
  setLearnStatus(`학습 저장 완료: ${data.exercise} -> ${patternLabels[data.pattern] || data.pattern}`);
}

addMemberBtn.addEventListener('click', async () => {
  try {
    const member = newMemberInput.value.trim();
    if (!member) return;
    if (!isValidMemberDisplayName(member)) {
      setStatus('회원 형식은 이름 (1234) 로 입력해줘.', true);
      newMemberInput.focus();
      return;
    }
    const data = await api('/api/members', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member }),
    });
    state.members = data.members;
    renderMembers();
    memberSelect.value = data.member;
    newMemberInput.value = '';
    setStatus('회원 추가 완료');
    await loadNotes();
  } catch (e) {
    setStatus(e.message, true);
  }
});

addExerciseBtn.addEventListener('click', addExercise);
exerciseInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addExercise();
  }
});
exerciseInput.addEventListener('input', () => {
  clearTimeout(exerciseSuggestTimer);
  exerciseSuggestTimer = setTimeout(() => {
    loadExerciseSuggestions(exerciseInput.value).catch(() => {});
  }, 220);
  if (!learnExerciseInput.value.trim()) learnExerciseInput.value = exerciseInput.value;
});

exerciseToolSelect.addEventListener('change', () => {
  loadExerciseSuggestions(exerciseInput.value).catch(() => {});
});

exerciseTargetSelect.addEventListener('change', () => {
  loadExerciseSuggestions(exerciseInput.value).catch(() => {});
});

learnSaveBtn.addEventListener('click', () => {
  saveLearnPattern().catch(e => setLearnStatus(e.message, true));
});

movementLoadBtn.addEventListener('click', () => {
  loadMovements().catch(e => setMovementStatus(e.message, true));
});

movementSearchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    loadMovements().catch(err => setMovementStatus(err.message, true));
  }
});

movementSelect.addEventListener('change', () => {
  const item = state.movements[Number(movementSelect.value)];
  fillMovementForm(item || null);
});

movementSaveBtn.addEventListener('click', () => {
  saveMovement().catch(e => setMovementStatus(e.message, true));
});

movementMergeBtn.addEventListener('click', () => {
  mergeMovement().catch(e => setMovementStatus(e.message, true));
});

memberSelect.addEventListener('change', () => {
  loadNotes().catch(e => setStatus(e.message, true));
});

loadNotesBtn.addEventListener('click', () => {
  loadNotes().catch(e => setStatus(e.message, true));
});

noteEditSaveBtn.addEventListener('click', () => {
  saveEditedNote().catch(e => setStatus(e.message, true));
});

noteEditCancelBtn.addEventListener('click', () => {
  closeEditPanel();
  setStatus('수정을 취소했어.');
});

noteSearchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    loadNotes().catch(err => setStatus(err.message, true));
  }
});

previewBtn.addEventListener('click', async () => {
  try {
    setStatus('미리보기 생성 중...');
    const data = await api('/api/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    });
    previewBox.innerHTML = renderMarkdown(data.markdown);
    const engine = data.engine === 'gpt' ? 'GPT' : 'RULE';
    const msg = data.gptError ? ` (${data.gptError})` : '';
    setStatus(`미리보기 완료 [${engine}]${msg}`);
  } catch (e) {
    setStatus(e.message, true);
  }
});

saveBtn.addEventListener('click', async () => {
  try {
    setStatus('저장 중...');
    const data = await api('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    });
    const syncMsg = data.sync && data.sync.synced ? ` | sync:${data.sync.reason}` : (data.sync ? ` | sync_fail:${data.sync.reason}` : '');
    const engine = data.engine === 'gpt' ? 'GPT' : 'RULE';
    const gptMsg = data.gptError ? ` | gpt:${data.gptError}` : '';
    if (syncFailed(data.sync)) {
      setStatus(syncFailureMessage('저장', data.sync), true);
      if (typeof loadNotes === 'function') await loadNotes();
      return;
    }
    setStatus(`완료[${engine}]: ${data.savedPath}${syncMsg}${gptMsg}`);
    if (typeof loadNotes === 'function') await loadNotes();
    closeEditPanel();
    resetComposer();
  } catch (e) {
    setStatus(e.message, true);
  }
});

(async function init() {
  setToday();
  await loadSystemInfo();
  await loadMembers();
  await loadExerciseSuggestions('');
  await loadPatternKeys();
  await loadMovements();
  await loadNotes();
  if (state.members.length === 0) {
    setStatus('먼저 회원을 추가해줘.');
  }
})();
















