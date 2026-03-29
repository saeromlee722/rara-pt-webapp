const state = {
  members: [],
  exercises: [],
  notes: [],
};

const dateInput = document.getElementById('dateInput');
const memberSelect = document.getElementById('memberSelect');
const newMemberInput = document.getElementById('newMemberInput');
const addMemberBtn = document.getElementById('addMemberBtn');
const exerciseInput = document.getElementById('exerciseInput');
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

function renderChips() {
  exerciseChips.innerHTML = '';
  state.exercises.forEach((name, idx) => {
    const li = document.createElement('li');
    li.textContent = name;
    const del = document.createElement('button');
    del.type = 'button';
    del.textContent = 'x';
    del.addEventListener('click', () => {
      state.exercises.splice(idx, 1);
      renderChips();
    });
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
  const data = await api(`/api/exercises?q=${encodeURIComponent(q)}`);
  renderExerciseList(data.items);
}

function addExercise() {
  const text = exerciseInput.value.trim();
  if (!text) return;
  if (!state.exercises.includes(text)) state.exercises.push(text);
  exerciseInput.value = '';
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

function setLearnStatus(text, isError = false) {
  learnStatus.textContent = text;
  learnStatus.style.color = isError ? '#b91c1c' : '#56635c';
}

async function loadPatternKeys() {
  const data = await api('/api/patterns');
  learnPatternSelect.innerHTML = '';
  (data.patternKeys || []).forEach(key => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = patternLabels[key] || key;
    learnPatternSelect.appendChild(opt);
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
  loadExerciseSuggestions(exerciseInput.value).catch(() => {});
  if (!learnExerciseInput.value.trim()) learnExerciseInput.value = exerciseInput.value;
});

learnSaveBtn.addEventListener('click', () => {
  saveLearnPattern().catch(e => setLearnStatus(e.message, true));
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
  await loadNotes();
  if (state.members.length === 0) {
    setStatus('먼저 회원을 추가해줘.');
  }
})();













