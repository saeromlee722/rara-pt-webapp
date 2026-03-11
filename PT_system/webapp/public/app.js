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
const previewBox = document.getElementById('previewBox');
const statusText = document.getElementById('statusText');
const networkInfo = document.getElementById('networkInfo');
const noteSearchInput = document.getElementById('noteSearchInput');
const loadNotesBtn = document.getElementById('loadNotesBtn');
const noteList = document.getElementById('noteList');

function setToday() {
  const now = new Date();
  const tzOffsetMs = now.getTimezoneOffset() * 60 * 1000;
  const localISO = new Date(now - tzOffsetMs).toISOString().slice(0, 10);
  dateInput.value = localISO;
}


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

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'danger';
    del.textContent = '삭제';
    del.addEventListener('click', async () => {
      const ok = confirm('정말 삭제할까?\n' + note.fileName);
      if (!ok) return;
      await deleteNote(note.fileName);
    });

    li.appendChild(file);
    li.appendChild(del);
    noteList.appendChild(li);
  });
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
    await loadNotes();
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
  };
}

function setStatus(text, isError = false) {
  statusText.textContent = text;
  statusText.style.color = isError ? '#b91c1c' : '#56635c';
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
});

memberSelect.addEventListener('change', () => {
  loadNotes().catch(e => setStatus(e.message, true));
});

loadNotesBtn.addEventListener('click', () => {
  loadNotes().catch(e => setStatus(e.message, true));
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
    setStatus('미리보기 완료');
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
    setStatus(`완료: ${data.savedPath}`);
  } catch (e) {
    setStatus(e.message, true);
  }
});

(async function init() {
  setToday();
  await loadSystemInfo();
  await loadMembers();
  await loadExerciseSuggestions('');
  await loadNotes();
  if (state.members.length === 0) {
    setStatus('먼저 회원을 추가해줘.');
  }
})();













