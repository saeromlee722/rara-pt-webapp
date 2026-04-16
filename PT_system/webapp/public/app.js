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

function buildExerciseItem() {
  const name = exerciseInput.value.trim();
  const tool = exerciseToolSelect.value.trim();
  const target = exerciseTargetSelect.value.trim();
  const variant = exerciseVariantInput.value.trim();
  if (!name) return null;

  const details = [target, variant].filter(Boolean).join(', ');
  const displayName = `${[tool, name].filter(Boolean).join(' ')}${details ? ` (${details})` : ''}`.trim();
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
  const all = state.exerciseCatalog;
  if (!query) return all.slice(0, 20);
  const limit = query.length >= 2 ? 20 : 15;
  return all.filter(item => item.includes(query)).slice(0, limit);
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
















