const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const today = new Date().toISOString().slice(0, 10);

const STATUS_STYLE = {
  abnormal: ['Abnormal', 'bad'],
  overdue: ['Overdue', 'warn'],
  'due-soon': ['Due soon', ''],
  'up-to-date': ['Up to date', 'good'],
  'not-eligible': ['Not eligible', 'muted'],
};
const TABS = [['', 'All'], ['abnormal', 'Abnormal'], ['overdue', 'Overdue'], ['due-soon', 'Due soon'], ['up-to-date', 'Up to date'], ['not-eligible', 'Not eligible']];
let currentTab = 'abnormal';
let worklist = [];

// The API key lives only in this browser tab's session.
const keyInput = $('api-key');
try { keyInput.value = sessionStorage.getItem('registryKey') || ''; } catch { /* storage unavailable */ }
keyInput.addEventListener('change', () => {
  try { sessionStorage.setItem('registryKey', keyInput.value); } catch { /* ignore */ }
  refresh();
});

async function api(path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (keyInput.value) headers.Authorization = `Bearer ${keyInput.value}`;
  const res = await fetch(path, body ? { method: 'POST', headers, body: JSON.stringify(body) } : { headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.issue?.[0]?.diagnostics || `HTTP ${res.status}`);
  return data;
}

const pill = (status) => {
  const [label, cls] = STATUS_STYLE[status] || [status, ''];
  return `<span class="pill ${cls}">${esc(label)}</span>`;
};

function renderTabs() {
  const counts = Object.fromEntries(TABS.map(([k]) => [k, k ? worklist.filter((r) => r.status === k).length : worklist.length]));
  $('tabs').innerHTML = TABS.map(([k, label]) =>
    `<button type="button" data-tab="${k}" aria-pressed="${k === currentTab}">${esc(label)} (${counts[k]})</button>`).join('');
}

function renderWorklist() {
  const rows = worklist.filter((r) => !currentTab || r.status === currentTab);
  const shown = rows.slice(0, 200);
  $('worklist').innerHTML = `
    <thead><tr><th>Registry ID</th><th>Name</th><th>Age</th><th>District</th><th>Status</th><th>Last screen</th><th>Last outcome</th><th>Due</th></tr></thead>
    <tbody>${shown.map((r) => `<tr>
      <td>${esc(r.registryId)}</td><td>${esc(r.name)}</td><td>${esc(r.age)}</td><td>${esc(r.district)}</td>
      <td>${pill(r.status)}</td><td>${esc(r.lastScreen || 'never')}</td><td>${esc(r.lastOutcome || '—')}</td><td>${esc(r.dueDate)}</td>
    </tr>`).join('')}</tbody>`;
  $('worklist-note').textContent = rows.length > shown.length ? `Showing ${shown.length} of ${rows.length}.` : '';
}

function renderPatients() {
  const select = $('patient-select');
  const keep = select.value;
  const sorted = [...worklist].sort((a, b) => b.registryId.localeCompare(a.registryId));
  select.innerHTML = sorted.map((r) => `<option value="${esc(r.id)}">${esc(r.registryId)} · ${esc(r.name)} (${esc(r.age)})</option>`).join('');
  if (keep) select.value = keep;
}

async function refresh() {
  try {
    const [alerts, rows] = await Promise.all([api('api/alerts'), api('api/worklist')]);
    worklist = rows;
    $('alert-count').textContent = `(${alerts.length})`;
    $('alerts').innerHTML = `
      <thead><tr><th>Priority</th><th>Alert</th><th>Patient</th><th>Since</th></tr></thead>
      <tbody>${alerts.slice(0, 100).map((a) => `<tr>
        <td>${a.priority === 'PH' ? '<span class="pill bad">High</span>' : '<span class="pill warn">Medium</span>'}</td>
        <td>${esc(a.detail)}</td><td>${esc(a.registryId)} · ${esc(a.patientName)}</td><td>${esc(a.since)}</td>
      </tr>`).join('')}</tbody>`;
    renderTabs();
    renderWorklist();
    renderPatients();
  } catch (err) {
    $('alerts').innerHTML = `<tr><td>${esc(err.message)}</td></tr>`;
  }
}

$('tabs').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tab]');
  if (!btn) return;
  currentTab = btn.dataset.tab;
  renderTabs();
  renderWorklist();
});

const formData = (form) => Object.fromEntries(new FormData(form));

$('register').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('register-msg');
  try {
    const { patient, evaluation } = await api('api/register', formData(e.target));
    msg.innerHTML = `Registered ${esc(patient.identifier[0].value)}: ${pill(evaluation.status)}`;
    e.target.reset();
    await refresh();
    $('patient-select').value = patient.id;
  } catch (err) { msg.textContent = err.message; }
});

$('result').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('result-msg');
  try {
    const { evaluation } = await api('api/results', formData(e.target));
    msg.innerHTML = `Saved. Status now ${pill(evaluation.status)}, next due ${esc(evaluation.dueDate)}.`;
    await refresh();
  } catch (err) { msg.textContent = err.message; }
});

$('colpo').addEventListener('click', async () => {
  const form = $('result');
  const msg = $('result-msg');
  try {
    const { patientId, date } = formData(form);
    const { evaluation } = await api('api/follow-up', { patientId, date });
    msg.innerHTML = `Colposcopy recorded. Status now ${pill(evaluation.status)}, next due ${esc(evaluation.dueDate)}.`;
    await refresh();
  } catch (err) { msg.textContent = err.message; }
});

document.querySelector('#result input[name=date]').value = today;
refresh();
