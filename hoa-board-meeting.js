// ============================================================
// STATE
// ============================================================
const INITIAL_STATE = {
  orgName: '',
  meetingDate: '',
  meetingType: 'BOARD OF DIRECTORS MEETING',
  meetingLocation: '',
  meetingAddress: '',
  timeCalled: '',
  timeAdjourned: '',
  additionalAttendees: '',
  roster: [],
  attendance: {},
  agenda: [],
  discussion: [],
  actionItems: []
};
let state = createInitialState();

const RECURRING_AGENDA = [
  { title: 'Call to Order', type: 'Procedural', notes: '', recurring: true },
  { title: 'Approval of Prior Meeting Minutes', type: 'Action', notes: '', recurring: true },
  { title: "Treasurer's Report", type: 'Report', notes: '', recurring: true },
  { title: 'Open Forum / Public Comment', type: 'Discussion', notes: '', recurring: true },
  { title: 'Adjournment', type: 'Procedural', notes: '', recurring: true }
];

const TAB_NAMES = ['setup', 'attendance', 'agenda', 'discussion', 'actions', 'minutes'];
const FIELD_ID_TO_STATE_KEY = {
  'time-called': 'timeCalled',
  'time-adjourned': 'timeAdjourned'
};
const speechState = {
  supported: false,
  recognition: null,
  activeField: null,
  targetField: null,
  interimTranscript: '',
  status: '',
  error: '',
  runId: 0,
  buttonEl: null,
  statusEl: null,
  hideTimer: null,
  inactivityTimer: null
};
const recordingState = {
  supported: typeof window !== 'undefined' && Boolean(window.MediaRecorder && navigator.mediaDevices?.getUserMedia),
  mediaRecorder: null,
  stream: null,
  activeDiscussionId: null,
  chunks: [],
  status: '',
  error: '',
  audioByDiscussion: {}
};

// ============================================================
// INIT
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
  initSpeechRecognition();
  loadFromStorage();
  renderAll();
  startClock();

  if (!state.meetingDate) {
    const today = getLocalDateInputValue();
    state.meetingDate = today;
    document.getElementById('meeting-date').value = today;
    persist();
  }
});

function createInitialState() {
  return JSON.parse(JSON.stringify(INITIAL_STATE));
}

// ============================================================
// CLOCK
// ============================================================
function startClock() {
  function tick() {
    const now = new Date();
    document.getElementById('live-clock').textContent =
      now.toLocaleTimeString('en-US', { hour12: false });
  }

  tick();
  setInterval(tick, 1000);
}

// ============================================================
// TABS
// ============================================================
function showTab(name) {
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));

  document.getElementById(`tab-${name}`).classList.add('active');

  const tabIndex = TAB_NAMES.indexOf(name);
  if (tabIndex >= 0) {
    document.querySelectorAll('.tab')[tabIndex]?.classList.add('active');
  }

  if (name === 'attendance') renderAttendance();
  if (name === 'minutes') generateMinutes();
}

function showTabByName(name) {
  showTab(name);
}

// ============================================================
// SPEECH
// ============================================================
function initSpeechRecognition() {
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  speechState.supported = Boolean(SpeechRecognitionCtor);

  initGlobalDictationUi();
  bindGlobalDictationEvents();

  if (!speechState.supported) {
    speechState.error = 'Dictation requires Chrome speech recognition support.';
    updateDictationUi();
    return;
  }

  const recognition = new SpeechRecognitionCtor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';
  speechState.recognition = recognition;

  recognition.onresult = (event) => {
    if (!speechState.activeField) return;

    let finalText = '';
    let interimText = '';

    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalText += transcript;
      } else {
        interimText += transcript;
      }
    }

    speechState.interimTranscript = interimText.trim();
    if (speechState.interimTranscript || finalText.trim()) {
      resetSpeechInactivityTimer();
    }
    if (finalText.trim()) {
      insertDictationText(speechState.activeField, finalText);
      speechState.status = 'Listening...';
    }
    updateDictationUi();
  };

  recognition.onerror = (event) => {
    if (event.error === 'no-speech') {
      speechState.status = 'Listening... no speech detected yet.';
      speechState.error = '';
    } else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      speechState.error = 'Microphone access was denied.';
      speechState.status = '';
    } else {
      speechState.error = `Dictation error: ${event.error}.`;
      speechState.status = '';
    }
    speechState.interimTranscript = '';
    updateDictationUi();
  };

  recognition.onend = () => {
    speechState.activeField = null;
    speechState.interimTranscript = '';
    if (!speechState.error) {
      speechState.status = 'Dictation stopped.';
    }
    updateDictationUi();
  };

  updateDictationUi();
}

function initGlobalDictationUi() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dictation-fab';
  button.textContent = 'Mic';
  button.addEventListener('click', () => toggleGlobalDictation());
  button.addEventListener('mouseenter', clearDictationHideTimer);
  button.addEventListener('mouseleave', scheduleDictationHideIfIdle);

  const status = document.createElement('div');
  status.className = 'dictation-status';

  document.body.appendChild(button);
  document.body.appendChild(status);

  speechState.buttonEl = button;
  speechState.statusEl = status;
}

function bindGlobalDictationEvents() {
  document.addEventListener('focusin', (event) => {
    const field = getEligibleDictationField(event.target);
    if (!field) return;
    if (speechState.activeField && speechState.activeField !== field) {
      stopGlobalDictation('Dictation stopped after switching fields.');
    }
    setDictationTarget(field);
  });

  document.addEventListener('focusout', (event) => {
    const field = getEligibleDictationField(event.target);
    if (!field) return;
    window.setTimeout(() => {
      if (document.activeElement !== field && speechState.activeField !== field) {
        scheduleDictationHideIfIdle();
      }
    }, 0);
  });

  document.addEventListener('mouseover', (event) => {
    const field = getEligibleDictationField(event.target);
    if (!field) return;
    setDictationTarget(field);
  });

  document.addEventListener('mouseout', (event) => {
    const field = getEligibleDictationField(event.target);
    if (!field) return;
    if (speechState.buttonEl?.contains(event.relatedTarget)) return;
    if (document.activeElement === field) return;
    scheduleDictationHideIfIdle();
  });

  document.addEventListener('keydown', (event) => {
    if (!(event.altKey && event.shiftKey && event.key.toLowerCase() === 'm')) return;
    const field = getEligibleDictationField(document.activeElement) || speechState.targetField;
    if (!field) return;
    event.preventDefault();
    setDictationTarget(field);
    toggleGlobalDictation(field);
  });

  window.addEventListener('scroll', () => updateDictationUi(), true);
  window.addEventListener('resize', () => updateDictationUi());
}

function getEligibleDictationField(node) {
  if (!(node instanceof HTMLElement)) return null;
  const field = node.closest('textarea, input[type="text"]');
  if (!field || field.disabled || field.readOnly) return null;
  return field;
}

function setDictationTarget(field) {
  clearDictationHideTimer();
  speechState.targetField = field;
  updateDictationUi();
}

function toggleGlobalDictation(field = speechState.targetField || getEligibleDictationField(document.activeElement)) {
  if (!field) return;

  if (speechState.activeField === field) {
    stopGlobalDictation();
  } else {
    startGlobalDictation(field);
  }
}

function startGlobalDictation(field) {
  if (!speechState.supported || !speechState.recognition) {
    speechState.error = 'Dictation is unavailable in this browser.';
    updateDictationUi();
    return;
  }

  if (speechState.activeField && speechState.activeField !== field) {
    stopGlobalDictation();
  }

  speechState.activeField = field;
  speechState.targetField = field;
  speechState.interimTranscript = '';
  speechState.status = 'Listening...';
  speechState.error = '';
  field.focus();
  resetSpeechInactivityTimer();

  try {
    speechState.recognition.start();
  } catch (error) {
    speechState.activeField = null;
    speechState.error = 'Unable to start dictation. Check microphone permissions in Chrome.';
    speechState.status = '';
  }

  updateDictationUi();
}

function stopGlobalDictation(reason = 'Dictation stopped.') {
  if (!speechState.recognition || !speechState.activeField) return;

  clearSpeechInactivityTimer();
  speechState.status = reason;
  speechState.interimTranscript = '';

  try {
    speechState.recognition.stop();
  } catch (error) {
    speechState.error = 'Unable to stop dictation cleanly.';
  }

  updateDictationUi();
}

function insertDictationText(field, transcript) {
  const text = formatDictationText(field, transcript);
  const start = typeof field.selectionStart === 'number' ? field.selectionStart : field.value.length;
  const end = typeof field.selectionEnd === 'number' ? field.selectionEnd : field.value.length;

  field.focus();
  if (typeof field.setRangeText === 'function') {
    field.setRangeText(text, start, end, 'end');
  } else {
    field.value = `${field.value.slice(0, start)}${text}${field.value.slice(end)}`;
  }

  field.dispatchEvent(new Event('input', { bubbles: true }));
  resetSpeechInactivityTimer();
}

function formatDictationText(field, transcript) {
  const incoming = transcript.trim();
  if (!incoming) return '';

  const start = typeof field.selectionStart === 'number' ? field.selectionStart : field.value.length;
  const before = field.value.slice(0, start);
  if (!before) return incoming;

  return /\s$/.test(before) ? incoming : ` ${incoming}`;
}

function updateDictationUi() {
  const button = speechState.buttonEl;
  const status = speechState.statusEl;
  const field = speechState.activeField || speechState.targetField;
  if (!button || !status) return;

  if (!field || !document.body.contains(field)) {
    button.classList.remove('visible', 'active');
    status.classList.remove('visible', 'error');
    return;
  }

  const rect = field.getBoundingClientRect();
  const top = Math.max(12, rect.top + 8);
  const left = Math.min(window.innerWidth - 64, rect.right - 56);

  button.style.top = `${top}px`;
  button.style.left = `${Math.max(12, left)}px`;
  button.classList.add('visible');
  button.classList.toggle('active', speechState.activeField === field);
  button.textContent = speechState.activeField === field ? 'Stop' : 'Mic';

  const message = speechState.error || speechState.interimTranscript || speechState.status;
  if (message) {
    status.textContent = message;
    status.style.top = `${top + 42}px`;
    status.style.left = `${Math.max(12, left - 12)}px`;
    status.classList.add('visible');
    status.classList.toggle('error', Boolean(speechState.error));
  } else {
    status.classList.remove('visible', 'error');
  }
}

function clearDictationHideTimer() {
  if (speechState.hideTimer) {
    window.clearTimeout(speechState.hideTimer);
    speechState.hideTimer = null;
  }
}

function scheduleDictationHideIfIdle() {
  clearDictationHideTimer();
  if (speechState.activeField) return;

  speechState.hideTimer = window.setTimeout(() => {
    const focused = getEligibleDictationField(document.activeElement);
    speechState.targetField = focused;
    updateDictationUi();
  }, 150);
}

function resetSpeechInactivityTimer() {
  clearSpeechInactivityTimer();
  if (!speechState.activeField) return;

  speechState.inactivityTimer = window.setTimeout(() => {
    if (speechState.activeField) {
      stopGlobalDictation('Dictation stopped after 10 seconds of inactivity.');
    }
  }, 10000);
}

function clearSpeechInactivityTimer() {
  if (speechState.inactivityTimer) {
    window.clearTimeout(speechState.inactivityTimer);
    speechState.inactivityTimer = null;
  }
}

// ============================================================
// RECORDING
// ============================================================
async function startDiscussionRecording(discId) {
  if (!recordingState.supported) {
    recordingState.error = 'Audio recording is unavailable in this browser.';
    renderDiscussion();
    return;
  }

  if (recordingState.activeDiscussionId && recordingState.activeDiscussionId !== discId) {
    stopDiscussionRecording();
  }

  if (recordingState.activeDiscussionId === discId) {
    return;
  }

  cleanupDiscussionAudio(discId);

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);

    recordingState.mediaRecorder = recorder;
    recordingState.stream = stream;
    recordingState.activeDiscussionId = discId;
    recordingState.chunks = [];
    recordingState.status = 'Recording...';
    recordingState.error = '';

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordingState.chunks.push(event.data);
      }
    };

    recorder.onstop = () => {
      const activeId = recordingState.activeDiscussionId || discId;
      const mimeType = recorder.mimeType || 'audio/webm';
      const blob = new Blob(recordingState.chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);

      cleanupDiscussionAudio(activeId);
      recordingState.audioByDiscussion[activeId] = {
        blob,
        url,
        mimeType,
        createdAt: new Date().toISOString()
      };

      stopRecordingStream();
      recordingState.mediaRecorder = null;
      recordingState.chunks = [];
      recordingState.activeDiscussionId = null;
      recordingState.status = 'Recording saved locally for this session.';
      renderDiscussion();
    };

    recorder.onerror = () => {
      recordingState.error = 'Audio recording failed.';
      stopRecordingStream();
      recordingState.mediaRecorder = null;
      recordingState.chunks = [];
      recordingState.activeDiscussionId = null;
      recordingState.status = '';
      renderDiscussion();
    };

    recorder.start();
    renderDiscussion();
  } catch (error) {
    recordingState.error = 'Microphone access was denied for audio recording.';
    recordingState.status = '';
    renderDiscussion();
  }
}

function stopDiscussionRecording() {
  if (!recordingState.mediaRecorder || recordingState.mediaRecorder.state === 'inactive') return;

  recordingState.status = 'Finishing recording...';
  recordingState.mediaRecorder.stop();
  renderDiscussion();
}

function stopRecordingStream() {
  if (recordingState.stream) {
    recordingState.stream.getTracks().forEach((track) => track.stop());
    recordingState.stream = null;
  }
}

function cleanupDiscussionAudio(discId) {
  const existing = recordingState.audioByDiscussion[discId];
  if (!existing) return;
  URL.revokeObjectURL(existing.url);
  delete recordingState.audioByDiscussion[discId];
}

function downloadDiscussionAudio(discId) {
  const audio = recordingState.audioByDiscussion[discId];
  if (!audio) return;

  const item = state.discussion.find((discussionItem) => discussionItem.id === discId);
  const safeTitle = (item?.title || 'discussion-audio').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'discussion-audio';
  const extension = audio.mimeType.includes('ogg') ? 'ogg' : 'webm';
  const anchor = document.createElement('a');
  anchor.href = audio.url;
  anchor.download = `${safeTitle}.${extension}`;
  anchor.click();
}

function deleteDiscussionAudio(discId) {
  cleanupDiscussionAudio(discId);
  if (recordingState.activeDiscussionId === discId) {
    stopDiscussionRecording();
  }
  recordingState.status = 'Recording removed.';
  recordingState.error = '';
  renderDiscussion();
}

function getRecordingStatus(discId) {
  if (!recordingState.supported) {
    return { className: 'recording-status', text: recordingState.error || 'Audio recording unavailable.' };
  }
  if (recordingState.activeDiscussionId === discId) {
    return { className: 'recording-status active', text: recordingState.status || 'Recording...' };
  }
  if (recordingState.error) {
    return { className: 'recording-status', text: recordingState.error };
  }
  if (recordingState.audioByDiscussion[discId]) {
    return { className: 'recording-status', text: 'Recording available locally.' };
  }
  return { className: 'recording-status', text: recordingState.status || 'Ready to record audio.' };
}

// ============================================================
// SETUP / ROSTER
// ============================================================
function updateOrgDisplay() {
  const val = document.getElementById('org-name').value;
  state.orgName = val;
  document.getElementById('display-org-name').textContent = val || 'Homeowners Association';
  persist();
}

function addRosterMember(name = '', role = '') {
  const id = 'mbr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  state.roster.push({ id, name, role });
  if (!state.attendance[id]) {
    state.attendance[id] = { status: 'present', timeArrived: '', timeDeparted: '' };
  }
  renderRoster();
  renderAttendance();
  persist();
}

function removeRosterMember(id) {
  state.roster = state.roster.filter((member) => member.id !== id);
  delete state.attendance[id];
  renderRoster();
  renderAttendance();
  persist();
}

function renderRoster() {
  const tbody = document.getElementById('roster-body');
  if (!state.roster.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="empty-state" style="padding:16px;">No members added.</td></tr>';
    return;
  }

  tbody.innerHTML = state.roster
    .map((member) => `
    <tr>
      <td><input type="text" value="${esc(member.name)}" placeholder="Full Name" oninput="updateRosterField('${member.id}','name',this.value)"></td>
      <td>
        <select oninput="updateRosterField('${member.id}','role',this.value)">
          ${['President', 'Vice President', 'Secretary', 'Treasurer', 'Board Member', 'Property Manager']
            .map((role) => `<option ${member.role === role ? 'selected' : ''}>${role}</option>`)
            .join('')}
        </select>
      </td>
      <td><button class="btn btn-danger btn-sm btn-icon" onclick="removeRosterMember('${member.id}')">✕</button></td>
    </tr>
  `)
    .join('');
}

function updateRosterField(id, field, value) {
  const member = state.roster.find((item) => item.id === id);
  if (member) {
    member[field] = value;
    persist();
  }
}

// ============================================================
// ATTENDANCE
// ============================================================
function renderAttendance() {
  const grid = document.getElementById('attendance-grid');
  if (!state.roster.length) {
    grid.innerHTML = '<div class="empty-state">No board members added yet. Go to Setup → Board Roster.</div>';
    return;
  }

  grid.innerHTML = state.roster
    .map((member) => {
      const att = state.attendance[member.id] || { status: 'present', timeArrived: '', timeDeparted: '' };
      const statuses = ['present', 'absent', 'late', 'departed'];
      return `
    <div class="member-card ${att.status}" id="mc_${member.id}">
      <div class="member-name">${esc(member.name || 'Unnamed')}</div>
      <div class="member-role">${esc(member.role)}</div>
      <div class="member-status-btns">
        ${statuses
          .map(
            (status) =>
              `<button class="status-btn ${att.status === status ? 'active-' + status : ''}" onclick="setAttendance('${member.id}','${status}')">${status.charAt(0).toUpperCase() + status.slice(1)}</button>`
          )
          .join('')}
      </div>
      ${att.status === 'late' || att.status === 'present'
        ? `
      <div class="member-time">
        <div><label>Arrived</label><input type="time" value="${att.timeArrived || ''}" oninput="setAttendanceTime('${member.id}','timeArrived',this.value)"><div class="time-display">${esc(toDisplayTime(att.timeArrived))}</div></div>
      </div>`
        : ''}
      ${att.status === 'departed'
        ? `
      <div class="member-time">
        <div><label>Departed</label><input type="time" value="${att.timeDeparted || ''}" oninput="setAttendanceTime('${member.id}','timeDeparted',this.value)"><div class="time-display">${esc(toDisplayTime(att.timeDeparted))}</div></div>
      </div>`
        : ''}
    </div>`;
    })
    .join('');
}

function setAttendance(id, status) {
  if (!state.attendance[id]) state.attendance[id] = {};
  state.attendance[id].status = status;

  if (status === 'late' && !state.attendance[id].timeArrived) {
    state.attendance[id].timeArrived = currentTime();
  }
  if (status === 'departed' && !state.attendance[id].timeDeparted) {
    state.attendance[id].timeDeparted = currentTime();
  }

  renderAttendance();
  persist();
}

function setAttendanceTime(id, field, value) {
  if (!state.attendance[id]) state.attendance[id] = {};
  state.attendance[id][field] = normalizeTimeValue(value);
  persist();
}

function markAll(status) {
  state.roster.forEach((member) => {
    if (!state.attendance[member.id]) state.attendance[member.id] = {};
    state.attendance[member.id].status = status;
  });
  renderAttendance();
  persist();
}

function stampNow(fieldId) {
  const field = document.getElementById(fieldId);
  const stateKey = FIELD_ID_TO_STATE_KEY[fieldId];
  if (!field || !stateKey) return;

  const time = currentTime();
  field.value = time;
  state[stateKey] = time;
  persist();
}

// ============================================================
// AGENDA
// ============================================================
function loadRecurringAgenda() {
  RECURRING_AGENDA.forEach((item) => {
    if (!state.agenda.find((agendaItem) => agendaItem.title === item.title)) {
      state.agenda.push({ id: uid(), ...item });
    }
  });
  renderAgenda();
  persist();
}

function addAgendaItem() {
  state.agenda.push({ id: uid(), title: '', type: 'Discussion', notes: '', recurring: false });
  renderAgenda();
  persist();
}

function removeAgendaItem(id) {
  state.agenda = state.agenda.filter((item) => item.id !== id);
  renderAgenda();
  persist();
}

function updateAgendaField(id, field, value) {
  const item = state.agenda.find((agendaItem) => agendaItem.id === id);
  if (item) {
    item[field] = value;
    persist();
  }
}

function renderAgenda() {
  const list = document.getElementById('agenda-list');
  if (!state.agenda.length) {
    list.innerHTML = '<div class="empty-state">No agenda items yet.</div>';
    return;
  }

  list.innerHTML = state.agenda
    .map(
      (item, index) => `
    <div class="agenda-item">
      <div class="agenda-num">${index + 1}.</div>
      <div class="agenda-content">
        <div class="agenda-title-row">
          <input type="text" value="${esc(item.title)}" placeholder="Agenda item title" style="flex:1;font-weight:600;" oninput="updateAgendaField('${item.id}','title',this.value)">
          <select style="width:140px;" onchange="updateAgendaField('${item.id}','type',this.value)">
            ${['Discussion', 'Action', 'Report', 'Procedural', 'Information']
              .map((type) => `<option ${item.type === type ? 'selected' : ''}>${type}</option>`)
              .join('')}
          </select>
          ${item.recurring ? '<span class="badge badge-recurring">↻ Recurring</span>' : ''}
        </div>
        <input type="text" value="${esc(item.notes)}" placeholder="Notes / description (optional)" style="margin-top:6px;font-size:12px;" oninput="updateAgendaField('${item.id}','notes',this.value)">
      </div>
      <div class="agenda-actions">
        <button class="btn btn-success btn-sm" onclick="sendToDiscussion('${item.id}')">▶ Discuss</button>
        <button class="btn btn-ghost btn-sm btn-icon" onclick="removeAgendaItem('${item.id}')">✕</button>
      </div>
    </div>
  `
    )
    .join('');
}

function sendToDiscussion(agendaId) {
  const item = state.agenda.find((agendaItem) => agendaItem.id === agendaId);
  if (!item) return;
  if (state.discussion.find((discussionItem) => discussionItem.agendaId === agendaId)) {
    alert('This item is already in the discussion list.');
    return;
  }

  state.discussion.push({
    id: uid(),
    agendaId,
    title: item.title,
    type: item.type,
    timeStarted: currentTime(),
    notes: '',
    motions: []
  });
  renderDiscussion();
  persist();
  showTabByName('discussion');
}

function importAgendaToDiscussion() {
  let added = 0;
  state.agenda.forEach((item) => {
    if (!state.discussion.find((discussionItem) => discussionItem.agendaId === item.id)) {
      state.discussion.push({
        id: uid(),
        agendaId: item.id,
        title: item.title,
        type: item.type,
        timeStarted: '',
        notes: '',
        motions: []
      });
      added += 1;
    }
  });
  renderDiscussion();
  persist();
  if (added) alert(`${added} agenda item(s) imported to discussion.`);
}

// ============================================================
// DISCUSSION
// ============================================================
function addDiscussionItem() {
  state.discussion.push({ id: uid(), agendaId: null, title: '', type: 'Discussion', timeStarted: currentTime(), notes: '', motions: [] });
  renderDiscussion();
  persist();
}

function removeDiscussionItem(id) {
  if (recordingState.activeDiscussionId === id) {
    stopDiscussionRecording();
  }
  cleanupDiscussionAudio(id);
  state.discussion = state.discussion.filter((item) => item.id !== id);
  renderDiscussion();
  persist();
}

function updateDiscussionField(id, field, value) {
  const item = state.discussion.find((discussionItem) => discussionItem.id === id);
  if (item) {
    item[field] = isTimeField(field) ? normalizeTimeValue(value) : value;
    persist();
  }
}

function addMotion(discId) {
  const disc = state.discussion.find((discussionItem) => discussionItem.id === discId);
  if (!disc) return;
  disc.motions.push({ id: uid(), text: '', movedBy: '', secondedBy: '', yea: '', nay: '', abstain: '', result: '' });
  renderDiscussion();
  persist();
}

function removeMotion(discId, motionId) {
  const disc = state.discussion.find((discussionItem) => discussionItem.id === discId);
  if (disc) {
    disc.motions = disc.motions.filter((motion) => motion.id !== motionId);
    renderDiscussion();
    persist();
  }
}

function updateMotionField(discId, motionId, field, value) {
  const disc = state.discussion.find((discussionItem) => discussionItem.id === discId);
  if (!disc) return;
  const motion = disc.motions.find((item) => item.id === motionId);
  if (motion) {
    motion[field] = value;
    persist();
  }
}

function setMotionResult(discId, motionId, result) {
  const disc = state.discussion.find((discussionItem) => discussionItem.id === discId);
  if (!disc) return;
  const motion = disc.motions.find((item) => item.id === motionId);
  if (motion) {
    motion.result = motion.result === result ? '' : result;
    renderDiscussion();
    persist();
  }
}

function renderDiscussion() {
  const list = document.getElementById('discussion-list');
  if (!state.discussion.length) {
    list.innerHTML = '<div class="empty-state card">No discussion items. Import from agenda or add manually.</div>';
    return;
  }

  list.innerHTML = state.discussion
    .map(
      (disc, index) => {
        const recording = recordingState.audioByDiscussion[disc.id];
        const recordingStatus = getRecordingStatus(disc.id);
        const isRecording = recordingState.activeDiscussionId === disc.id;
        return `
    <div class="discussion-item">
      <div class="discussion-header">
        <span class="disc-num">${index + 1}.</span>
        <input type="text" value="${esc(disc.title)}" placeholder="Discussion topic" style="flex:1;background:transparent;border:none;color:#fff;font-size:14px;font-weight:600;outline:none;" oninput="updateDiscussionField('${disc.id}','title',this.value)">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:11px;opacity:.7;">Started:</span>
          <div style="display:flex;flex-direction:column;gap:2px;">
            <input type="time" value="${disc.timeStarted || ''}" style="background:transparent;border:1px solid rgba(255,255,255,.3);color:#fff;border-radius:4px;padding:2px 6px;font-size:12px;" oninput="updateDiscussionField('${disc.id}','timeStarted',this.value)">
            <span style="font-size:11px;opacity:.8;">${esc(toDisplayTime(disc.timeStarted))}</span>
          </div>
          <button onclick="updateDiscussionField('${disc.id}','timeStarted','${currentTime()}');renderDiscussion();" style="background:rgba(255,255,255,.2);border:none;color:#fff;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;">⏱ Now</button>
          <button onclick="removeDiscussionItem('${disc.id}')" style="background:rgba(255,0,0,.3);border:none;color:#fff;border-radius:4px;padding:2px 8px;cursor:pointer;font-size:11px;">✕</button>
        </div>
      </div>
      <div class="discussion-body">
        <div class="recording-panel">
          <div class="recording-row">
            <button class="btn ${isRecording ? 'btn-danger' : 'btn-ghost'} btn-sm" onclick="${isRecording ? 'stopDiscussionRecording()' : `startDiscussionRecording('${disc.id}')`}" ${!recordingState.supported && !isRecording ? 'disabled' : ''}>
              ${isRecording ? 'Stop Recording' : 'Record Audio'}
            </button>
            ${recording ? `<button class="btn btn-ghost btn-sm" onclick="downloadDiscussionAudio('${disc.id}')">Download</button>` : ''}
            ${recording ? `<button class="btn btn-ghost btn-sm" onclick="deleteDiscussionAudio('${disc.id}')">Delete</button>` : ''}
            <span class="${recordingStatus.className}">${esc(recordingStatus.text)}</span>
          </div>
          ${recording ? `<audio class="audio-player" controls src="${recording.url}"></audio>` : ''}
        </div>
        <textarea class="discussion-notes-area" placeholder="Discussion notes, summary, decisions..." rows="3" oninput="updateDiscussionField('${disc.id}','notes',this.value)">${esc(disc.notes)}</textarea>

        <div class="motions-section">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
            <div class="motions-title">Motions</div>
            <button class="btn btn-primary btn-sm" onclick="addMotion('${disc.id}')">+ Add Motion</button>
          </div>
          ${disc.motions.length === 0 ? '<div class="text-muted" style="padding:4px 0;">No motions for this item.</div>' : ''}
          ${disc.motions
            .map(
              (motion) => `
            <div class="motion-item">
              <div class="motion-text-row">
                <input type="text" placeholder="Motion text (e.g. Motion to approve...)" value="${esc(motion.text)}" oninput="updateMotionField('${disc.id}','${motion.id}','text',this.value)" style="flex:1;">
                <button class="btn btn-danger btn-sm btn-icon" onclick="removeMotion('${disc.id}','${motion.id}')">✕</button>
              </div>
              <div class="vote-row">
                <label>Moved by:</label>
                <select style="width:140px;" onchange="updateMotionField('${disc.id}','${motion.id}','movedBy',this.value)">
                  <option value="">-- Select --</option>
                  ${state.roster
                    .map((member) => `<option ${motion.movedBy === member.name ? 'selected' : ''}>${esc(member.name)}</option>`)
                    .join('')}
                </select>
                <label>Seconded by:</label>
                <select style="width:140px;" onchange="updateMotionField('${disc.id}','${motion.id}','secondedBy',this.value)">
                  <option value="">-- Select --</option>
                  ${state.roster
                    .map((member) => `<option ${motion.secondedBy === member.name ? 'selected' : ''}>${esc(member.name)}</option>`)
                    .join('')}
                </select>
                <label>Yea:</label><input class="vote-input" type="text" value="${esc(motion.yea)}" placeholder="0" oninput="updateMotionField('${disc.id}','${motion.id}','yea',this.value)">
                <label>Nay:</label><input class="vote-input" type="text" value="${esc(motion.nay)}" placeholder="0" oninput="updateMotionField('${disc.id}','${motion.id}','nay',this.value)">
                <label>Abstain:</label><input class="vote-input" type="text" value="${esc(motion.abstain)}" placeholder="0" oninput="updateMotionField('${disc.id}','${motion.id}','abstain',this.value)">
              </div>
              <div class="motion-result">
                <span style="font-size:12px;color:var(--muted);margin-right:4px;">Result:</span>
                ${['passed', 'failed', 'tabled']
                  .map(
                    (result) =>
                      `<button class="result-btn ${motion.result === result ? 'active-' + result : ''}" onclick="setMotionResult('${disc.id}','${motion.id}','${result}')">${result.charAt(0).toUpperCase() + result.slice(1)}</button>`
                  )
                  .join('')}
              </div>
            </div>
          `
            )
            .join('')}
        </div>
      </div>
    </div>
  `;
      }
    )
    .join('');
}

// ============================================================
// ACTION ITEMS
// ============================================================
function addActionItem() {
  state.actionItems.push({ id: uid(), text: '', assignedTo: '', dueDate: '', done: false });
  renderActionItems();
  persist();
}

function removeActionItem(id) {
  state.actionItems = state.actionItems.filter((item) => item.id !== id);
  renderActionItems();
  persist();
}

function updateActionField(id, field, value) {
  const item = state.actionItems.find((actionItem) => actionItem.id === id);
  if (item) {
    item[field] = value;
    persist();
  }
}

function toggleActionDone(id) {
  const item = state.actionItems.find((actionItem) => actionItem.id === id);
  if (item) {
    item.done = !item.done;
    renderActionItems();
    persist();
  }
}

function renderActionItems() {
  const list = document.getElementById('action-items-list');
  if (!state.actionItems.length) {
    list.innerHTML = '<div class="empty-state">No action items yet.</div>';
    return;
  }

  list.innerHTML = state.actionItems
    .map(
      (item) => `
    <div class="action-item ${item.done ? 'done' : ''}">
      <input type="checkbox" ${item.done ? 'checked' : ''} onchange="toggleActionDone('${item.id}')">
      <div class="action-content">
        <input type="text" value="${esc(item.text)}" placeholder="Action item description" style="flex:2;" oninput="updateActionField('${item.id}','text',this.value)">
        <select style="width:160px;" onchange="updateActionField('${item.id}','assignedTo',this.value)">
          <option value="">Assigned to...</option>
          ${state.roster
            .map((member) => `<option ${item.assignedTo === member.name ? 'selected' : ''}>${esc(member.name)}</option>`)
            .join('')}
          <option ${item.assignedTo === 'All Board' ? 'selected' : ''}>All Board</option>
          <option ${item.assignedTo === 'Property Manager' ? 'selected' : ''}>Property Manager</option>
        </select>
        <input type="date" value="${item.dueDate || ''}" style="width:140px;" oninput="updateActionField('${item.id}','dueDate',this.value)">
      </div>
      <button class="btn btn-danger btn-sm btn-icon" onclick="removeActionItem('${item.id}')">✕</button>
    </div>
  `
    )
    .join('');
}

// ============================================================
// MINUTES GENERATION
// ============================================================
function generateMinutes() {
  syncFormValues();
  const org = state.orgName || '[HOA NAME]';
  const date = state.meetingDate ? formatDate(state.meetingDate) : '[DATE]';
  const type = state.meetingType || 'BOARD OF DIRECTORS MEETING';
  const location = state.meetingLocation || state.meetingAddress || '[LOCATION]';
  const timeCalled = state.timeCalled ? fmt12(state.timeCalled) : '[TIME]';
  const timeAdjourned = state.timeAdjourned ? fmt12(state.timeAdjourned) : '[TIME]';

  const present = state.roster.filter((member) => {
    const att = state.attendance[member.id];
    return !att || att.status === 'present' || att.status === 'late' || att.status === 'departed';
  });
  const absent = state.roster.filter((member) => state.attendance[member.id]?.status === 'absent');

  const attendanceHTML = present.length
    ? present
        .map((member) => {
          const att = state.attendance[member.id] || {};
          let note = '';
          if (att.status === 'late' && att.timeArrived) note = ` (arrived ${fmt12(att.timeArrived)})`;
          if (att.status === 'departed' && att.timeDeparted) note = ` (departed ${fmt12(att.timeDeparted)})`;
          return `<div class="min-attendance-row"><span class="min-attendance-name">${esc(member.name)}</span><span class="min-attendance-note">${esc(member.role)}${note}</span></div>`;
        })
        .join('')
    : '<div style="font-size:13px;color:#666;">No attendance recorded.</div>';

  const absentHTML = absent.length
    ? absent
        .map(
          (member) =>
            `<div class="min-attendance-row"><span class="min-attendance-name">${esc(member.name)}</span><span class="min-attendance-note">${esc(member.role)}</span></div>`
        )
        .join('')
    : '';

  const addlAttendees = state.additionalAttendees
    ? `<p style="font-size:13px;margin-top:6px;"><strong>Also Present:</strong> ${esc(state.additionalAttendees)}</p>`
    : '';

  const discussionHTML = state.discussion.length
    ? state.discussion
        .map((disc, index) => {
          const motionsHTML = disc.motions
            .map((motion) => {
              const voteStr = [
                motion.yea ? `Yea: ${motion.yea}` : '',
                motion.nay ? `Nay: ${motion.nay}` : '',
                motion.abstain ? `Abstain: ${motion.abstain}` : ''
              ]
                .filter(Boolean)
                .join(' | ');
              const resultClass = motion.result ? `result-${motion.result}` : '';
              const resultLabel = motion.result ? motion.result.charAt(0).toUpperCase() + motion.result.slice(1) : '';
              return `
        <div class="min-motion">
          <div class="min-motion-text">MOTION: ${esc(motion.text) || '[Motion text not recorded]'}</div>
          <div class="min-motion-vote">
            ${motion.movedBy ? `Moved by: <strong>${esc(motion.movedBy)}</strong>` : ''}
            ${motion.secondedBy ? ` &nbsp;|&nbsp; Seconded by: <strong>${esc(motion.secondedBy)}</strong>` : ''}
            ${voteStr ? ` &nbsp;|&nbsp; Vote: ${voteStr}` : ''}
          </div>
          ${resultLabel ? `<div><span class="min-motion-result ${resultClass}">${resultLabel}</span></div>` : ''}
        </div>`;
            })
            .join('');

          const timeStr = disc.timeStarted
            ? ` <span style="font-size:12px;font-weight:400;color:#777;">(${fmt12(disc.timeStarted)})</span>`
            : '';
          return `
      <div class="min-agenda-item">
        <div class="min-agenda-title">${index + 1}. ${esc(disc.title) || '[Untitled Item]'}${timeStr}</div>
        ${disc.notes ? `<div class="min-agenda-notes">${esc(disc.notes)}</div>` : ''}
        ${motionsHTML}
      </div>`;
        })
        .join('')
    : '<p style="font-size:13px;color:#666;margin-left:12px;">No discussion items recorded.</p>';

  const actionHTML = state.actionItems.length
    ? state.actionItems
        .map(
          (item) =>
            `<div class="min-action-item"><span style="flex:1;">${esc(item.text) || '[Action item]'}</span>${item.assignedTo ? `<strong>${esc(item.assignedTo)}</strong>` : ''}${item.dueDate ? ` - Due: ${formatDate(item.dueDate)}` : ''}</div>`
        )
        .join('')
    : '<p style="font-size:13px;color:#666;">No action items recorded.</p>';

  const secretary = state.roster.find((member) => member.role === 'Secretary');
  const president = state.roster.find((member) => member.role === 'President');

  const html = `
    <div class="min-org">${esc(org)}</div>
    <div class="min-doc-title">${esc(type)} - Minutes</div>
    <div class="min-meta">${date} &nbsp;|&nbsp; ${esc(location)}</div>
    <hr class="min-divider">

    <div class="min-section">
      <div class="min-section-title">Call to Order</div>
      <p style="font-size:13px;">The ${esc(type.toLowerCase())} of ${esc(org)} was called to order at ${timeCalled} by ${president ? esc(president.name) + ', President' : 'the presiding officer'}.</p>
    </div>

    <div class="min-section">
      <div class="min-section-title">Board Members Present</div>
      <div class="min-attendance-grid">${attendanceHTML}</div>
      ${absentHTML ? `<div style="margin-top:10px;"><strong style="font-size:12px;text-transform:uppercase;color:#888;letter-spacing:.5px;">Absent</strong><div class="min-attendance-grid" style="margin-top:6px;">${absentHTML}</div></div>` : ''}
      ${addlAttendees}
    </div>

    <hr class="min-divider-thin">

    <div class="min-section">
      <div class="min-section-title">Agenda Items</div>
      ${discussionHTML}
    </div>

    <hr class="min-divider-thin">

    <div class="min-section">
      <div class="min-section-title">Action Items</div>
      ${actionHTML}
    </div>

    <hr class="min-divider-thin">

    <div class="min-section">
      <div class="min-section-title">Adjournment</div>
      <p style="font-size:13px;">There being no further business, the meeting was adjourned at ${timeAdjourned}.</p>
    </div>

    <div class="min-sig-block">
      <div>
        <div class="min-sig-line">${president ? esc(president.name) + ', President' : 'President'}</div>
      </div>
      <div>
        <div class="min-sig-line">${secretary ? esc(secretary.name) + ', Secretary' : 'Secretary'}</div>
      </div>
    </div>

    <div class="min-footer">Minutes recorded by ${secretary ? esc(secretary.name) : 'Secretary'} &nbsp;|&nbsp; ${esc(org)} &nbsp;|&nbsp; ${date}</div>
  `;

  document.getElementById('minutes-preview').innerHTML = html;
}

function printMinutes() {
  generateMinutes();
  setTimeout(() => window.print(), 200);
}

// ============================================================
// PERSISTENCE
// ============================================================
function syncFormValues() {
  state.orgName = document.getElementById('org-name').value;
  state.meetingDate = document.getElementById('meeting-date').value;
  state.meetingType = document.getElementById('meeting-type').value;
  state.meetingLocation = document.getElementById('meeting-location').value;
  state.meetingAddress = document.getElementById('meeting-address').value;
  state.timeCalled = normalizeTimeValue(document.getElementById('time-called').value);
  state.timeAdjourned = normalizeTimeValue(document.getElementById('time-adjourned').value);
  state.additionalAttendees = document.getElementById('additional-attendees').value;
  renderSetupTimeDisplays();
}

function persist() {
  syncFormValues();
  localStorage.setItem('hoa_meeting_state', JSON.stringify(state));
}

function loadFromStorage() {
  try {
    const saved = localStorage.getItem('hoa_meeting_state');
    if (saved) {
      const parsed = JSON.parse(saved);
      Object.assign(state, parsed);
    }
  } catch (error) {
    // Ignore invalid local state and continue with defaults.
  }
}

function renderAll() {
  document.getElementById('org-name').value = state.orgName || '';
  document.getElementById('meeting-date').value = state.meetingDate || '';
  document.getElementById('meeting-type').value = state.meetingType || 'BOARD OF DIRECTORS MEETING';
  document.getElementById('meeting-location').value = state.meetingLocation || '';
  document.getElementById('meeting-address').value = state.meetingAddress || '';
  document.getElementById('time-called').value = state.timeCalled || '';
  document.getElementById('time-adjourned').value = state.timeAdjourned || '';
  document.getElementById('additional-attendees').value = state.additionalAttendees || '';
  document.getElementById('display-org-name').textContent = state.orgName || 'Homeowners Association';
  renderSetupTimeDisplays();
  renderRoster();
  renderAttendance();
  renderAgenda();
  renderDiscussion();
  renderActionItems();
}

function saveData() {
  syncFormValues();
  const data = JSON.stringify(state, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  const dateStr = state.meetingDate || getLocalDateInputValue();
  anchor.download = `hoa-meeting-${dateStr}.json`;
  anchor.click();
}

function clearMeeting() {
  const confirmed = window.confirm('Clear the current meeting data from this browser? This will reset the current meeting and local autosave.');
  if (!confirmed) return;

  stopGlobalDictation('Dictation stopped.');
  if (recordingState.activeDiscussionId) {
    stopDiscussionRecording();
  }
  stopRecordingStream();
  Object.keys(recordingState.audioByDiscussion).forEach((discId) => cleanupDiscussionAudio(discId));
  recordingState.mediaRecorder = null;
  recordingState.chunks = [];
  recordingState.status = '';
  recordingState.error = '';
  recordingState.activeDiscussionId = null;

  state = createInitialState();
  const today = getLocalDateInputValue();
  state.meetingDate = today;

  localStorage.removeItem('hoa_meeting_state');
  renderAll();
  persist();
  showTabByName('setup');
}

function loadData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const loaded = JSON.parse(ev.target.result);
        Object.assign(state, loaded);
        renderAll();
        persist();
        alert('Meeting data loaded successfully.');
      } catch (error) {
        alert('Error loading file.');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

// ============================================================
// HELPERS
// ============================================================
function uid() {
  return 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
}

function currentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function getLocalDateInputValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function isTimeField(field) {
  return ['timeStarted', 'timeArrived', 'timeDeparted'].includes(field);
}

function toDisplayTime(value) {
  const normalized = normalizeTimeValue(value);
  return normalized && /^\d{2}:\d{2}$/.test(normalized) ? fmt12(normalized) : value || '';
}

function normalizeTimeValue(value) {
  const raw = (value || '').trim();
  if (!raw) return '';

  const directMatch = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (directMatch) {
    const hours = parseInt(directMatch[1], 10);
    const minutes = parseInt(directMatch[2], 10);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
  }

  const meridiemMatch = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp][Mm])$/);
  if (!meridiemMatch) return raw;

  let hours = parseInt(meridiemMatch[1], 10);
  const minutes = parseInt(meridiemMatch[2] || '0', 10);
  const meridiem = meridiemMatch[3].toUpperCase();

  if (hours < 1 || hours > 12 || minutes < 0 || minutes > 59) return raw;
  if (meridiem === 'AM') {
    hours = hours === 12 ? 0 : hours;
  } else if (hours !== 12) {
    hours += 12;
  }

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function renderSetupTimeDisplays() {
  const calledDisplay = document.getElementById('time-called-display');
  const adjournedDisplay = document.getElementById('time-adjourned-display');
  if (calledDisplay) calledDisplay.textContent = toDisplayTime(state.timeCalled);
  if (adjournedDisplay) adjournedDisplay.textContent = toDisplayTime(state.timeAdjourned);
}

function esc(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(str) {
  if (!str) return '';
  const [year, month, day] = str.split('-');
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${months[parseInt(month, 10) - 1]} ${parseInt(day, 10)}, ${year}`;
}

function fmt12(time) {
  if (!time) return '';
  const [hours, minutes] = time.split(':');
  const hr = parseInt(hours, 10);
  const ampm = hr >= 12 ? 'PM' : 'AM';
  const hr12 = hr === 0 ? 12 : hr > 12 ? hr - 12 : hr;
  return `${hr12}:${minutes} ${ampm}`;
}

document.addEventListener('input', (e) => {
  if (['org-name', 'meeting-date', 'meeting-type', 'meeting-location', 'meeting-address', 'time-called', 'time-adjourned', 'additional-attendees'].includes(e.target.id)) {
    persist();
    if (e.target.id === 'org-name') updateOrgDisplay();
  }
});
