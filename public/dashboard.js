const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
let threshold = 5;

const fmt = (n) => (n === null || n === undefined ? `<${threshold}` : n.toLocaleString());
const pct = (p) => (p === null || p === undefined ? '—' : `${p}%`);

function kpi(label, value, cls = '') {
  return `<div class="card kpi"><div class="label">${esc(label)}</div><div class="value ${cls}">${esc(value)}</div></div>`;
}

function bars(rows, labelKey) {
  return rows.map((r) => `
    <div class="bar-row">
      <span>${esc(r[labelKey])}</span>
      <span class="bar" role="img" aria-label="${esc(pct(r.coveragePct))} coverage"><span style="width:${r.coveragePct ?? 0}%"></span></span>
      <span class="num">${esc(pct(r.coveragePct))}</span>
    </div>`).join('');
}

const OUTCOME_LABELS = {
  negative: 'HPV negative',
  'hpv-positive-nilm': 'HPV positive, normal cytology',
  abnormal: 'Abnormal (referred)',
  inadequate: 'Inadequate sample',
};

async function load() {
  const res = await fetch(document.body.dataset.statsUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const s = await res.json();
  threshold = s.suppressionThreshold;
  $('threshold').textContent = threshold - 1;
  $('threshold2').textContent = threshold;

  const t = s.totals;
  $('kpis').innerHTML = [
    kpi('Eligible women', fmt(t.eligible)),
    kpi('Coverage', pct(t.coveragePct), t.coveragePct >= 70 ? 'good' : 'warn'),
    kpi('Overdue', fmt(t.overdue), 'warn'),
    kpi('Never screened', fmt(t.neverScreened), 'warn'),
    kpi('Abnormal, awaiting follow-up', fmt(t.abnormalAwaitingFollowUp), 'bad'),
    kpi('Screened in last 12 months', fmt(t.screenedLast12Months)),
  ].join('');

  $('age').innerHTML = bars(s.byAgeBand, 'band');
  $('district').innerHTML = bars(s.byDistrict, 'district');

  const outcomeTotal = Object.values(s.outcomesLast12Months).reduce((a, b) => a + (b || 0), 0);
  $('outcomes').innerHTML = Object.entries(s.outcomesLast12Months).map(([k, n]) => `
    <div class="bar-row">
      <span>${esc(OUTCOME_LABELS[k] || k)}</span>
      <span class="bar"><span style="width:${outcomeTotal && n ? (n / outcomeTotal) * 100 : 0}%"></span></span>
      <span class="num">${esc(fmt(n))}</span>
    </div>`).join('');

  $('district-table').innerHTML = `
    <thead><tr><th>District</th><th class="num">Eligible</th><th class="num">Covered</th><th class="num">Overdue</th><th class="num">Never</th></tr></thead>
    <tbody>${s.byDistrict.map((d) => `<tr><td>${esc(d.district)}</td><td class="num">${esc(fmt(d.eligible))}</td>
      <td class="num">${esc(fmt(d.covered))}</td><td class="num">${esc(fmt(d.overdue))}</td><td class="num">${esc(fmt(d.neverScreened))}</td></tr>`).join('')}</tbody>`;

  $('generated').textContent = `Figures as of ${s.generatedOn}${s.syntheticData ? ' · synthetic data' : ''}.`;
}

load().catch((err) => { $('kpis').innerHTML = `<div class="card">Could not load statistics (${esc(err.message)}).</div>`; });
