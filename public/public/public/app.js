// public/app.js

window.addEventListener('DOMContentLoaded', () => {
  console.log('[LiveTracker] app.js loaded, wiring UI…');

  // ------- Grab elements (with guards) -------
  const tbody = document.querySelector('#taskTable tbody');
  const importBtn = document.getElementById('importBtn');
  const fileInput = document.getElementById('fileInput');
  const exportBtn = document.getElementById('exportBtn');
  const clearBtn = document.getElementById('clearBtn');
  const pauseDialog = document.getElementById('pauseDialog');
  const pauseReason = document.getElementById('pauseReason');
  const pauseNotes = document.getElementById('pauseNotes');
  const pauseTaskName = document.getElementById('pauseTaskName');
  const confirmPause = document.getElementById('confirmPause');

  if (!tbody || !importBtn || !fileInput || !exportBtn || !clearBtn || !pauseDialog || !pauseReason || !pauseTaskName || !confirmPause) {
    console.error('[LiveTracker] Missing required DOM nodes. Check index.html IDs.');
    return;
  }

  // ------- CSV header helpers -------
  function detectDelimiter(headerLine){
    const commas=(headerLine.match(/,/g)||[]).length;
    const semis =(headerLine.match(/;/g)||[]).length;
    return semis>commas?';':',';
  }
  function norm(h){
    return h.replace(/^\uFEFF/,'').trim().toLowerCase().replace(/\s+/g,' ');
  }
  const HEADER_ALIASES={
    'unique id':['unique id','uniqueid','task unique id','uid'],
    'name':['name','task name','taskname'],
    'summary':['summary','is summary','issummary'],
    'outline level':['outline level','outlinelevel','level'],
    'wbs':['wbs'],
    'start':['start','start date','start time','startdate'],
    'finish':['finish','finish date','finish time','finishdate'],
    '% complete':['% complete','percent complete','percentcomplete','%complete'],
    'resource names':['resource names','resources','resource name','resourcename'],
    'text5':['text5','department','dept'],
    'text30':['text30','department','dept']
  };
  function indexOfAlias(headers, key){
    const wants=HEADER_ALIASES[key]||[key];
    return headers.findIndex(h=>wants.includes(norm(h)));
  }
  function parseCSV(text){
    const lines=text.split(/\r?\n/).filter(l=>l.trim().length);
    if(!lines.length) throw new Error('Empty CSV');
    const delim=detectDelimiter(lines[0]);
    const headers=lines[0].split(delim).map(h=>h.replace(/^\uFEFF/,''));
    const rows=lines.slice(1).map(l=>l.split(delim));
    return {headers,rows,delim};
  }
  function buildColumnMap(headers){
    const col={
      uid:indexOfAlias(headers,'unique id'),
      name:indexOfAlias(headers,'name'),
      summary:indexOfAlias(headers,'summary'),
      outlineLevel:indexOfAlias(headers,'outline level'),
      wbs:indexOfAlias(headers,'wbs'),
      start:indexOfAlias(headers,'start'),
      finish:indexOfAlias(headers,'finish'),
      pct:indexOfAlias(headers,'% complete'),
      res:indexOfAlias(headers,'resource names'),
      text5:indexOfAlias(headers,'text5'),
      text30:indexOfAlias(headers,'text30')
    };
    const must=['uid','name','summary','outlineLevel','wbs','start','finish','pct'];
    const missing=must.filter(k=>col[k]===-1);
    if(missing.length){
      throw new Error(`Missing required columns: ${missing.join(', ')}`);
    }
    return col;
  }
  function pickDepartment(cells,col){
    const t30=(col.text30!==-1)?(cells[col.text30]||'').trim():'';
    const t5 =(col.text5 !==-1)?(cells[col.text5 ]||'').trim():'';
    if(t30) return t30;
    if(t5)  return t5;
    const res=(col.res!==-1)?(cells[col.res]||'').split(',')[0].trim():'';
    return res || '';
  }

  // ------- State & storage -------
  const state = { allTasks: [] };
  const LS_KEY='live-tracker-state';
  function saveLocal(){ localStorage.setItem(LS_KEY, JSON.stringify({ allTasks: state.allTasks })); }
  function loadLocal(){
    try{
      const s=JSON.parse(localStorage.getItem(LS_KEY)||'{}');
      if(Array.isArray(s.allTasks)) state.allTasks=s.allTasks;
    }catch{}
  }

  // ------- Time helpers -------
  function windowRange3d(){
    const now=new Date();
    const start=new Date(now.getFullYear(),now.getMonth(),now.getDate(),0,0,0,0);
    const end=new Date(start.getTime()+3*24*3600*1000-1); // end of day today+2
    return {start,end};
  }
  function overlaps(ps,pf,win){ return (ps<=win.end.getTime()) && (pf>=win.start.getTime()); }
  function fmt(ts){ if(!ts) return ''; return new Date(ts).toLocaleString(); }
  function delayMinutes(t){
    const p=new Date(t.PlannedStart).getTime();
    if(!t.ActualStart) return Math.max(0,Math.round((Date.now()-p)/60000));
    const a=new Date(t.ActualStart).getTime();
    return Math.max(0,Math.round((a-p)/60000));
  }
  function deptClass(d){
    const x=(d||'').toLowerCase();
    if(x.includes('rig')) return 'dept-rigging';
    if(x.includes('instr')) return 'dept-instruments';
    if(x.includes('mech')) return 'dept-mech';
    if(x.includes('op')) return 'dept-ops';
    return '';
  }

  // ------- Actions -------
  function startTask(uid){
    const t=state.allTasks.find(x=>x.TaskUID===uid); if(!t) return;
    const now=new Date().toISOString();
    if(t.State==='Idle'){
      t.ActualStart=now; t.State='Active'; t.lastStart=now; (t.Audit ||= []).push({type:'Start',time:now});
    }else if(t.State==='Paused'){
      t.State='Active';
      if(t.lastPause){
        const paused = new Date(now) - new Date(t.lastPause);
        t.TotalPausedMinutes += paused>0 ? Math.round(paused/60000) : 0;
      }
      t.lastStart=now; (t.Audit ||= []).push({type:'Resume',time:now});
    }
    saveLocal(); render();
  }
  function pauseTask(uid){
    const t=state.allTasks.find(x=>x.TaskUID===uid); if(!t||t.State!=='Active') return;
    openPause(uid, t.TaskName);
  }
  function finishTask(uid){
    const t=state.allTasks.find(x=>x.TaskUID===uid); if(!t) return;
    const now=new Date().toISOString();
    if(t.State==='Active' && t.lastStart){
      const active = new Date(now) - new Date(t.lastStart);
      t.TotalActiveMinutes += active>0 ? Math.round(active/60000) : 0;
    }
    if(t.State==='Paused' && t.lastPause){
      const paused = new Date(now) - new Date(t.lastPause);
      t.TotalPausedMinutes += paused>0 ? Math.round(paused/60000) : 0;
    }
    t.State='Finished'; t.ActualFinish=now; t.lastStart=null; t.lastPause=null;
    (t.Audit ||= []).push({type:'Finish',time:now});
    saveLocal(); render();
  }

  // expose for inline onclick handlers in table rows
  window.startTask = startTask;
  window.pauseTask = pauseTask;
  window.finishTask = finishTask;

  // ------- Pause modal -------
  let __pauseUID=null;
  function openPause(uid, name){
    __pauseUID=uid;
    pauseReason.value=''; pauseNotes.value=''; pauseTaskName.textContent=name;
    pauseDialog.showModal();
  }
  confirmPause.addEventListener('click',(e)=>{
    e.preventDefault();
    if(!pauseReason.value) return;
    const t=state.allTasks.find(x=>x.TaskUID===__pauseUID); if(!t) return;
    const now=new Date().toISOString();
    if(t.State==='Active' && t.lastStart){
      const active = new Date(now) - new Date(t.lastStart);
      t.TotalActiveMinutes += active>0 ? Math.round(active/60000) : 0;
    }
    t.State='Paused'; t.lastStart=null; t.lastPause=now;
    (t.Audit ||= []).push({type:'Pause',time:now,reason:pauseReason.value,notes:pauseNotes.value||''});
    pauseDialog.close(); saveLocal(); render();
  });

  // ------- UI wiring -------
  importBtn.addEventListener('click', ()=>{
    console.log('[LiveTracker] Import clicked');
    fileInput.click();
  });
  fileInput.addEventListener('change', async (e)=>{
    const file=e.target.files[0];
    if(!file){ console.log('[LiveTracker] No file chosen'); return; }
    console.log('[LiveTracker] Reading file:', file.name);
    await handleCsvFile(file);
    e.target.value='';
  });
  exportBtn.addEventListener('click', exportCsv);
  clearBtn.addEventListener('click', ()=>{
    if(confirm('Clear current project data?')){
      state.allTasks=[]; saveLocal(); render();
    }
  });

  // ------- Render -------
  function render(){
    const {start,end}=windowRange3d();
    const filtered = state.allTasks
      .filter(t => overlaps(new Date(t.PlannedStart).getTime(), new Date(t.PlannedFinish).getTime(), {start,end}))
      .sort((a,b)=> new Date(a.PlannedStart)-new Date(b.PlannedStart));

    tbody.innerHTML='';
    filtered.forEach(t=>{
      const tr=document.createElement('tr');
      const stateBadge = t.State && t.State!=='Idle' ? `<span class="state-badge state-${t.State.toLowerCase()}">${t.State}</span>` : '';
      tr.innerHTML=`
        <td>${t.SummaryTaskName||''}</td>
        <td>${t.TaskName} ${stateBadge}</td>
        <td><span class="chip ${deptClass(t.Department)}">${t.Department||''}</span></td>
        <td>${fmt(t.PlannedStart)}</td>
        <td>${fmt(t.ActualStart)}</td>
        <td>${delayMinutes(t)}</td>
        <td class="actions">
          <button class="primary" ${t.State==='Active'?'disabled':''} onclick="startTask('${t.TaskUID}')" aria-label="Start or Resume">${t.State==='Paused'?'Resume':'Start'}</button>
          <button ${t.State==='Active'?'':'disabled'} onclick="pauseTask('${t.TaskUID}')" aria-label="Pause">Pause</button>
          <button class="success" ${t.State==='Active'||t.State==='Paused'?'':'disabled'} onclick="finishTask('${t.TaskUID}')" aria-label="Finish">Finish</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    const notice = document.getElementById('notice');
    if (notice) {
      notice.textContent = state.allTasks.length
        ? 'Showing 3-day forecast (today → +2 days). Use Import CSV to load a different project.'
        : 'Import a Microsoft Project CSV to begin. Showing a 3-day forecast (today → +2 days).';
    }
  }
  setInterval(render, 30000);

  // ------- Import handler -------
  async function handleCsvFile(file){
    const text=await file.text();
    let parsed, col;
    try{
      parsed=parseCSV(text);
      col=buildColumnMap(parsed.headers);
      console.log('[LiveTracker] Parsed headers:', parsed.headers);
    }catch(e){
      alert(e.message || 'CSV parse error');
      console.error('[LiveTracker] CSV error:', e);
      return;
    }
    const stack=[]; const out=[];
    for(const cells of parsed.rows){
      const isSummaryStr=((cells[col.summary]||'')+'').trim().toLowerCase();
      const isSummary = isSummaryStr.startsWith('y') || isSummaryStr==='true' || isSummaryStr==='1';
      const level = parseInt((cells[col.outlineLevel]||'1'),10) || 1;
      const name  = (cells[col.name]||'').trim();
      stack[level]=name; stack.length=level+1;
      if(isSummary) continue;

      const summaryName = level>1 ? (stack[level-1]||'') : '';
      out.push({
        TaskUID:(cells[col.uid]||'').trim(),
        TaskName:name,
        SummaryTaskName:summaryName,
        Department:pickDepartment(cells,col),
        PlannedStart:new Date(cells[col.start]).toISOString(),
        PlannedFinish:new Date(cells[col.finish]).toISOString(),
        PercentComplete:parseInt((cells[col.pct]||'0'),10)||0,
        State:'Idle',
        ActualStart:null, ActualFinish:null,
        TotalActiveMinutes:0, TotalPausedMinutes:0,
        lastStart:null, lastPause:null,
        Audit:[]
      });
    }
    state.allTasks=out;
    saveLocal();
    console.log('[LiveTracker] Imported tasks:', out.length);
    render();
  }

  // ------- Export end-of-shift CSV -------
  function exportCsv(){
    const today=new Date();
    const yyyy=today.getFullYear(), mm=String(today.getMonth()+1).padStart(2,'0'), dd=String(today.getDate()).padStart(2,'0');
    const shiftDate=`${yyyy}-${mm}-${dd}`;
    const rows = state.allTasks.map(t=>[
      t.TaskUID, shiftDate, t.ActualStart||'', t.ActualFinish||'', t.TotalActiveMinutes, t.TotalPausedMinutes
    ].join(','));
    const csv = ['TaskUID,ShiftDate,ActualStart,ActualFinish,TotalActiveMinutes,TotalPausedMinutes', ...rows].join('\n');
    const blob=new Blob([csv],{type:'text/csv'});
    const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`shift_actuals_${shiftDate}.csv`; a.click();
  }

  // Init page
  loadLocal();
  render();
  console.log('[LiveTracker] UI wired. Click Import to test.');
});
