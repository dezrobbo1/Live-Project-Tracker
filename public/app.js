// --- wiring & error surfacing ---
function onReady(fn){
  if (document.readyState !== 'loading') fn();
  else document.addEventListener('DOMContentLoaded', fn);
}
function bind(id, ev, handler){
  const el = document.getElementById(id);
  if(!el){ console.error(`[wire] Missing element #${id}`); return; }
  el.addEventListener(ev, async (e)=>{
    try { await handler(e); }
    catch(err){ console.error(`[handler:${id}]`, err); alert(err?.message || String(err)); }
  });
}

// --- cross-browser header normalization ---
const BOM_RE = /^\uFEFF/;
function stripDiacritics(str) {
  if (typeof str.normalize === 'function') {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }
  const map = { á:'a',à:'a',ä:'a',â:'a',ã:'a',å:'a',æ:'ae',
                é:'e',è:'e',ë:'e',ê:'e',
                í:'i',ì:'i',ï:'i',î:'i',
                ó:'o',ò:'o',ö:'o',ô:'o',õ:'o',œ:'oe',
                ú:'u',ù:'u',ü:'u',û:'u',
                ç:'c',ñ:'n',ý:'y',ÿ:'y' };
  return str.replace(/[^\u0000-\u007E]/g, ch => map[ch] || ch);
}
function asciiKey(s) {
  return stripDiacritics(String(s || '').replace(BOM_RE, ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
const aliasMap = new Map([
  ['summary',      ['summary','task-summary-name','task-name','name']],
  ['start',        ['start','scheduled-start','actual-start','start-date','start-time']],
  ['finish',       ['finish','scheduled-finish','actual-finish','end','end-date','end-time']],
  ['department',   ['assigned-department','dept','department']],
  ['unique-id',    ['unique-id','uid','id']],
  ['percent-complete', ['percent-complete','complete','progress','percent']],
  ['scheduled-start',  ['scheduled-start']],
  ['actual-start',     ['actual-start']],
  ['scheduled-finish', ['scheduled-finish']],
  ['actual-finish',    ['actual-finish']],
  ['wbs',          ['wbs','outline-number']],
  ['outline-level',['outline-level','level']]
]);
function canonicalKey(rawHeader) {
  const k = asciiKey(rawHeader);
  for (const [canon, aliases] of aliasMap) {
    if (aliases.includes(k)) return canon;
  }
  return null;
}
function normalizeRow(rowObj) {
  const out = {};
  for (const [rawKey, val] of Object.entries(rowObj || {})) {
    const ck = canonicalKey(rawKey);
    if (ck) out[ck] = val;
  }
  return out;
}

// --- tiny API wrapper ---
async function api(path, opts={}){
  const res = await fetch(path, { headers:{'Content-Type':'application/json'}, ...opts });
  if(!res.ok){
    const t = await res.text().catch(()=>'');
    throw new Error(`HTTP ${res.status} ${res.statusText} – ${t.slice(0,200)}`);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

// --- UI rendering ---
const $tbody = document.getElementById('taskBody');
let tasks = [];

function render(){
  $tbody.innerHTML = '';
  for (const t of tasks) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${t['unique-id'] ?? ''}</td>
      <td>${t['summary'] ?? ''}</td>
      <td><span class="badge">${t['department'] ?? ''}</span></td>
      <td>${t['start'] ?? t['scheduled-start'] ?? ''}</td>
      <td>${t['finish'] ?? t['scheduled-finish'] ?? ''}</td>
      <td>${t['percent-complete'] ?? ''}</td>
    `;
    $tbody.appendChild(tr);
  }
}

// --- Import flow ---
async function handleImport(){
  console.log('[click] import');
  const fi = document.getElementById('fileInput');
  fi.value = '';
  fi.onchange = async () => {
    const file = fi.files?.[0];
    if(!file) return;
    const text = await file.text();
    const parsed = Papa.parse(text, { header:true, skipEmptyLines:true });
    if(parsed.errors?.length){
      console.warn('[csv] parse errors', parsed.errors.slice(0,3));
    }
    const rows = (parsed.data || []).map(normalizeRow);
    // Heuristic: require at least summary + one of start/finish
    const ok = rows.some(r => r.summary || r['task-summary-name']);
    if(!ok) alert('CSV parsed, but required columns were not found. Check headers.');
    tasks = rows;
    render();
    await api('/api/tasks', { method:'POST', body: JSON.stringify({ tasks }) });
    alert(`Imported ${rows.length} rows.`);
  };
  fi.click();
}

// --- Export ---
async function handleExport(){
  console.log('[click] export');
  const payload = await api('/api/export');
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'export.json';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// --- Delay log ---
async function handleDelayLog(){
  console.log('[click] delay');
  const message = prompt('Delay message?', 'Unspecified delay');
  const res = await api('/api/delay-log', { method:'POST', body: JSON.stringify({ message }) });
  alert(`Logged: ${res.entry.message}`);
}

// --- Clear ---
async function handleClear(){
  if(!confirm('Clear all tasks?')) return;
  await api('/api/clear', { method:'POST' });
  tasks = [];
  render();
  alert('Cleared.');
}

onReady(()=>{
  bind('btnImport', 'click', handleImport);
  bind('btnExport', 'click', handleExport);
  bind('btnDelayLog', 'click', handleDelayLog);
  bind('btnClear', 'click', handleClear);
  console.log('[wire] Buttons bound');
  // bootstrap view with server data if present
  api('/api/export').then(d => { tasks = d.tasks || []; render(); }).catch(()=>{});
});
