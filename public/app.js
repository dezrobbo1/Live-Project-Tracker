// Live Project Tracker — actions work + state persists across pages
// Features: CSV + MSP XML import, Text30-only Department, hide summaries, robust date parsing,
// buttons wired, and tasks saved/restored from localStorage so navigation doesn't lose data.

window.addEventListener("DOMContentLoaded", () => {
  console.log("%c[Tracker] app.js (actions + persistence)", "color:#6aa3ff");

  // ---- DOM ----
  const importBtn = document.getElementById("importBtn");
  const fileInput  = document.getElementById("fileInput");
  const exportBtn  = document.getElementById("exportBtn");
  const tbody      = document.querySelector("#taskTable tbody");

  const stripBom = (str="") => str.replace(/^\uFEFF/, "").replace(/\u0000/g, "");

  async function readFileSmart(file){
    if (!file) return "";
    if (file.arrayBuffer){
      const buffer = await file.arrayBuffer();
      if (!buffer.byteLength) return "";
      const view = new Uint8Array(buffer);
      const tryDecode = (label, start=0) => {
        try {
          return new TextDecoder(label).decode(start ? buffer.slice(start) : buffer);
        } catch {
          return null;
        }
      };

      if (view[0] === 0xFF && view[1] === 0xFE){
        return stripBom(tryDecode("utf-16le", 2) || tryDecode("utf-16le") || "");
      }
      if (view[0] === 0xFE && view[1] === 0xFF){
        return stripBom(tryDecode("utf-16be", 2) || tryDecode("utf-16be") || "");
      }
      if (view.length >= 3 && view[0] === 0xEF && view[1] === 0xBB && view[2] === 0xBF){
        return stripBom(tryDecode("utf-8", 3) || "");
      }

      if (view[0] === 0x00 && view[1] !== 0x00){
        const decoded = tryDecode("utf-16be");
        if (decoded) return stripBom(decoded);
      }
      if (view[0] !== 0x00 && view[1] === 0x00){
        const decoded = tryDecode("utf-16le");
        if (decoded) return stripBom(decoded);
      }

      const utf8 = tryDecode("utf-8");
      if (utf8) return stripBom(utf8);
    }

    if (file.text){
      const text = await file.text();
      return stripBom(text);
    }

    return "";
  }

  // Pause dialog
  const pauseDialog   = document.getElementById("pauseDialog");
  const pauseReason   = document.getElementById("pauseReason");
  const pauseNotes    = document.getElementById("pauseNotes");
  const pauseTaskName = document.getElementById("pauseTaskName");
  const confirmPause  = document.getElementById("confirmPause");

  // ---- State & persistence ----
  const STORE_KEY = "PROJECT_TASKS_V1";
  const DELAY_LOG_KEY = "DELAY_LOG_V1";
  let tasks = [];
  let pauseUID = null;

  function upgradeTask(task){
    if (!task || typeof task !== "object") return task;
    if (!("PlannedStartRaw" in task)) task.PlannedStartRaw = task.PlannedStart || "";
    if (!("PlannedFinishRaw" in task)) task.PlannedFinishRaw = task.PlannedFinish || "";
    return task;
  }

  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(tasks)); } catch {} };
  const load = () => {
    try { const raw = localStorage.getItem(STORE_KEY); const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; }
    catch { return []; }
  };

  // Initial restore (so returning from delay.html keeps your project)
  tasks = load().map(upgradeTask);
  render();

  // Delay log helpers
  const readDelayLog  = () => { try { return JSON.parse(localStorage.getItem(DELAY_LOG_KEY)||"[]"); } catch { return []; } };
  const writeDelayLog = (arr) => localStorage.setItem(DELAY_LOG_KEY, JSON.stringify(arr));
  const appendDelayLog= (entry) => { const a=readDelayLog(); a.push(entry); writeDelayLog(a); };

  // Clear button (called from index.html)
  window.clearProject = () => {
    if (!confirm("Clear current project data?")) return;
    tasks = [];
    save();
    const notice = document.getElementById("notice");
    if (notice) notice.textContent = "Import a Microsoft Project CSV or XML to begin. Showing a 3-day forecast (today → +2 days).";
    if (fileInput) fileInput.value = "";
    render();
    console.log("[Tracker] project cleared");
  };

  // ========= CSV helpers (tolerant headers / delimiters) =========
  function normHeader(h){
    return (h||"").replace(/^[\uFEFF\u200B]+/, "").replace(/[_-]+/g, " ").replace(/[^\p{L}\p{N}%\. ]+/gu, "")
      .trim().replace(/\s+/g, " ").toLowerCase();
  }
  const HEADER_ALIASES = {
    "unique id": ["unique id","uniqueid","task unique id","uid","unique id."],
    "name": ["name","task name","taskname"],
    // old "Summary" (Y/N) is optional now; keep aliases but we'll not require it
    "summary": ["summary","is summary","issummary"],

    "outline level": ["outline level","outlinelevel","level","outline lvl","outline"],
    "wbs": ["wbs"],

    // Accept MSP/Excel export variants
    "start": [
      "start","start date","start time","startdate","start datetime","start date time",
      "scheduled start"
    ],
    "finish": [
      "finish","finish date","finish time","finishdate","finish datetime","finish date time",
      "scheduled finish"
    ],

    "% complete": ["% complete","percent complete","percentcomplete","percent","pct complete","percent complete."],
    "resource names": ["resource names","resources","resource name","resourcename"],

    // Dept can be Text30 or an explicit column name
    "text30": ["text30","assigned department","department","dept","text 30","text-30","text_30"],

    // Optional direct parent summary name column
    "task summary name": ["task summary name","summary task name","parent summary","parent task"]
  };
  function detectDelimiter(text){
    const sample = (text.match(/^[^\r\n]*/)||[""])[0];
    const cands=[",",";","\t","|"];
    const counts=cands.map(ch => {
      let count=0, inQuotes=false;
      for(let i=0;i<sample.length;i++){
        const c=sample[i];
        if(c==='"'){
          if(inQuotes && sample[i+1]==='"'){ i++; }
          inQuotes=!inQuotes;
        }else if(c===ch && !inQuotes){
          count++;
        }
      }
      return count;
    });
    let best=0; for(let i=1;i<counts.length;i++) if(counts[i]>counts[best]) best=i;
    return cands[best] || ",";
  }
  function parseCSV(text){
    if(!text || !text.trim()) throw new Error("Empty CSV");
    const delim = detectDelimiter(text);
    const rows=[];
    let field="", row=[], inQuotes=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(ch==='"'){
        if(inQuotes && text[i+1]==='"'){
          field+='"';
          i++;
        }else{
          inQuotes=!inQuotes;
        }
      }else if(ch===delim && !inQuotes){
        row.push(field);
        field="";
      }else if((ch==='\n' || ch==='\r') && !inQuotes){
        if(ch==='\r' && text[i+1]==='\n') i++;
        row.push(field);
        rows.push(row);
        row=[];
        field="";
      }else{
        field+=ch;
      }
    }
    if(field.length || row.length){
      row.push(field);
      rows.push(row);
    }
    if(!rows.length) throw new Error("Empty CSV");
    const headers = rows.shift().map(h=>h.replace(/^[\uFEFF\u200B]+/,""));
    const body = rows.filter(r => r.some(cell => (cell||"").trim().length));
    return { headers, rows: body, delim };
  }
  function indexOfAlias(headers, canonical){
    const wants = (HEADER_ALIASES[canonical] || [canonical]).map(normHeader);
    const normalized = headers.map(normHeader);
    for (let i=0;i<normalized.length;i++) if (wants.includes(normalized[i])) return i;
    for (let i=0;i<normalized.length;i++){
      const h = normalized[i];
      if (canonical==="start"  && (h==="start date"||h==="start time")) return i;
      if (canonical==="finish" && (h==="finish date"||h==="finish time")) return i;
      if (canonical==="% complete" && (h==="percent complete"||h==="percent")) return i;
      if (canonical==="outline level" && (h==="outline lvl"||h==="outline")) return i;
    }
    if (canonical === "text30"){
      for (let i = 0; i < normalized.length; i++){
        const h = normalized[i];
        const compact = h.replace(/\s+/g, "");
        if (compact.includes("text30")) return i;
        if (/text\s*30/.test(h)) return i;
        if (/(assigned\s*)?(dept|department)/.test(h) && !/(baseline|remaining|cost|resource)/.test(h)) return i;
      }
    }
    return -1;
  }
  function buildColumnMap(headers){
    const col = {
      uid : indexOfAlias(headers,"unique id"),
      name: indexOfAlias(headers,"name"),
      summary:indexOfAlias(headers,"summary"), // may be -1 (missing)
      outlineLevel:indexOfAlias(headers,"outline level"),
      wbs:indexOfAlias(headers,"wbs"),
      start:indexOfAlias(headers,"start"),
      finish:indexOfAlias(headers,"finish"),
      pct:indexOfAlias(headers,"% complete"),
      res:indexOfAlias(headers,"resource names"),
      text30:indexOfAlias(headers,"text30"),
      taskSummaryName:indexOfAlias(headers,"task summary name")
    };
    const must=["uid","name","outlineLevel","wbs","start","finish","pct"];
    const missing=must.filter(k=>col[k]===-1);
    if(missing.length){
      const seen = headers.map(h=>normHeader(h)).join(" | ");
      throw new Error(`Missing required columns: ${missing.join(", ")}\nFound (normalized): ${seen}`);
    }
    return col;
  }

  // ======= Robust date parser for MSP CSV / locales =======
  function parseDateFlexible(s){
    if (!s) return ""; s = String(s).trim();
    s = s.replace(/\b(mon|tue|wed|thu|fri|sat|sun)(day)?\b[\s,]*/i, ""); // strip weekday
    s = s.replace(/,/g, "").replace(/\ba\.?m\.?\b/i,"AM").replace(/\bp\.?m\.?\b/i,"PM");
    let d = new Date(s); if (!isNaN(d)) return d.toISOString();

    let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
    if (m){
      let day=+m[1], mon=+m[2]-1, yr=+m[3]; if (yr<100) yr+=2000;
      let hh=+(m[4]||0), mm=+(m[5]||0), ss=+(m[6]||0); const ap=m[7];
      if (ap){ if (/pm/i.test(ap)&&hh<12) hh+=12; if (/am/i.test(ap)&&hh===12) hh=0; }
      d = new Date(yr,mon,day,hh,mm,ss); if(!isNaN(d)) return d.toISOString();
    }
    m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i);
    if (m){
      const monMap={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
      const monIdx = monMap[m[2].slice(0,3).toLowerCase()];
      let yr=+m[3]; if(yr<100) yr+=2000; let hh=+(m[4]||0), mm=+(m[5]||0), ss=+(m[6]||0); const ap=m[7];
      if (ap){ if (/pm/i.test(ap)&&hh<12) hh+=12; if (/am/i.test(ap)&&hh===12) hh=0; }
      d = new Date(yr,monIdx,+m[1],hh,mm,ss); if(!isNaN(d)) return d.toISOString();
    }
    return "";
  }

  // ========= MSP XML (namespace-safe) =========
  function ql(root, tag){ const out=[]; const all=root.getElementsByTagName("*"); for(let i=0;i<all.length;i++){ if(all[i].localName===tag) out.push(all[i]); } return out; }
  function firstText(el, tag){ const found = ql(el, tag)[0]; return found ? (found.textContent||"").trim() : ""; }
  function parseMSPXML(text){
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length){ throw new Error("XML parse error"); }
    const projectEls = ql(doc, "Project"); if (!projectEls.length) throw new Error("Not a valid Microsoft Project XML (MSPDI).");

    // ExtendedAttribute definitions: FieldID -> Alias
    const defMap = new Map();
    ql(doc, "ExtendedAttributes").forEach(node=>{
      ql(node,"ExtendedAttribute").forEach(def=>{
        const id = firstText(def, "FieldID");
        const alias = firstText(def, "Alias");
        if (id) defMap.set(id, alias || "");
      });
    });

    // Text30-only department
    function departmentFromXML(taskEl){
      let result = "";
      ql(taskEl,"ExtendedAttribute").forEach(a=>{
        const id = firstText(a,"FieldID");
        const val= firstText(a,"Value");
        if (!result && id === "188743734" && val) result = val; // Text30 heuristic
        const alias = id ? (defMap.get(id)||"") : "";
        if (!result && alias && /^assigned department$/i.test(alias) && val) result = val;
      });
      return result;
    }

    // Build map of WBS -> Task (includes summaries); then emit only non-summaries
    const allTasks = [];
    ql(doc,"Tasks").forEach(tasksNode=>{
      ql(tasksNode,"Task").forEach(taskEl=>{
        allTasks.push({
          uid:firstText(taskEl,"UID"),
          name:firstText(taskEl,"Name"),
          wbs:firstText(taskEl,"WBS"),
          olvl:parseInt(firstText(taskEl,"OutlineLevel")||"1",10)||1,
          isSummary:(firstText(taskEl,"Summary")||"0")==="1",
          start:firstText(taskEl,"Start"),
          finish:firstText(taskEl,"Finish"),
          pct:parseInt(firstText(taskEl,"PercentComplete")||"0",10)||0,
          el:taskEl
        });
      });
    });

    const byWBS = new Map(allTasks.map(t=>[t.wbs,t]));
    const out=[];
    for(const t of allTasks){
      if (t.isSummary) continue; // hide summary tasks
      let parentSummaryName = "";
      if (t.wbs && t.wbs.includes(".")){
        const parentWBS = t.wbs.split(".").slice(0,-1).join(".");
        parentSummaryName = byWBS.get(parentWBS)?.name || "";
      }
      const plannedStartISO = t.start ? new Date(t.start).toISOString() : "";
      const plannedFinishISO = t.finish ? new Date(t.finish).toISOString() : "";
      out.push({
        TaskUID: t.uid,
        TaskName: t.name,
        SummaryTaskName: parentSummaryName,
        Department: departmentFromXML(t.el),
        PlannedStart: plannedStartISO,
        PlannedFinish: plannedFinishISO,
        PlannedStartRaw: t.start || "",
        PlannedFinishRaw: t.finish || "",
        PercentComplete: t.pct,
        State:"Idle",
        ActualStart:null, ActualFinish:null,
        TotalActiveMinutes:0, TotalPausedMinutes:0,
        lastStart:null, lastPause:null,
        Audit:[]
      });
    }
    return out;
  }

  // ========= Import / Export =========
  importBtn?.addEventListener("click", ()=>fileInput?.click());
  fileInput?.addEventListener("change", async (e)=>{
    const file=e.target.files?.[0]; if(!file) return;
    const text = await readFileSmart(file);
    const isXML = /\.xml$/i.test(file.name) || /xml/.test(file.type);
    try{
      tasks = isXML ? parseMSPXML(text) : parseCSVToTasks(text);
      save();
      console.log(`[Tracker] imported ${tasks.length} task rows from ${isXML?'XML':'CSV'}`);
      console.table(tasks.slice(0,5).map(t=>({
        UID:t.TaskUID,
        Name:t.TaskName,
        Summary:t.SummaryTaskName,
        Start:t.PlannedStart || t.PlannedStartRaw,
        Dept:t.Department
      })));
    }catch(err){
      alert(err.message || "Import error");
      console.error(err);
      return;
    }
    e.target.value="";
    render();
  });

  function parseCSVToTasks(text){
    const parsed = parseCSV(text);
    const col = buildColumnMap(parsed.headers);

    const rows = parsed.rows.map(cells => {
      const rawSummary = col.summary !== -1 ? (cells[col.summary]||"").trim() : "";
      const isSummary = col.summary === -1 ? false : /^(y|yes|true|1)$/i.test(rawSummary);

      return {
        uid:(cells[col.uid]||"").trim(),
        name:(cells[col.name]||"").trim(),
        isSummary,
        wbs:(cells[col.wbs]||"").trim(),
        start:(cells[col.start]||"").trim(),
        finish:(cells[col.finish]||"").trim(),
        pct:parseInt((cells[col.pct]||"0"),10)||0,
        dept:(col.text30!==-1 ? (cells[col.text30]||"").trim() : ""),
        directParent:(col.taskSummaryName!==-1 ? (cells[col.taskSummaryName]||"").trim() : "")
      };
    });

    const byWBS = new Map(rows.map(r=>[r.wbs,r]));
    const out=[];
    for(const r of rows){
      if (r.isSummary) continue;

      let parentSummaryName = r.directParent || "";
      if (!parentSummaryName && r.wbs && r.wbs.includes(".")){
        const parentWBS = r.wbs.split(".").slice(0,-1).join(".");
        parentSummaryName = byWBS.get(parentWBS)?.name || "";
      }

      out.push({
        TaskUID:r.uid,
        TaskName:r.name,
        SummaryTaskName: parentSummaryName,
        Department:r.dept,
        PlannedStart: parseDateFlexible(r.start),
        PlannedFinish: parseDateFlexible(r.finish),
        PlannedStartRaw: r.start,
        PlannedFinishRaw: r.finish,
        PercentComplete: r.pct,
        State:"Idle",
        ActualStart:null, ActualFinish:null,
        TotalActiveMinutes:0, TotalPausedMinutes:0,
        lastStart:null, lastPause:null,
        Audit:[]
      });
    }
    return out;
  }

  exportBtn?.addEventListener("click", ()=>{
    const today=new Date();
    const yyyy=today.getFullYear(), mm=String(today.getMonth()+1).padStart(2,"0"), dd=String(today.getDate()).padStart(2,"0");
    const shiftDate=`${yyyy}-${mm}-${dd}`;
    const rows = tasks.map(t=>[
      t.TaskUID, shiftDate, t.ActualStart||"", t.ActualFinish||"", t.TotalActiveMinutes||0, t.TotalPausedMinutes||0
    ].join(","));
    const csv = ["TaskUID,ShiftDate,ActualStart,ActualFinish,TotalActiveMinutes,TotalPausedMinutes", ...rows].join("\n");
    const blob=new Blob([csv],{type:"text/csv"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`shift_actuals_${shiftDate}.csv`; a.click();
  });

  // ========= Actions / FSM =========
  function startTask(uid){
    try{
      const t = tasks.find(x=>x.TaskUID===uid); if(!t) return;
      const now = new Date().toISOString();
      if(t.State==="Idle"){
        t.ActualStart=now; t.State="Active"; t.lastStart=now; (t.Audit ||= []).push({type:"Start",time:now});
      }else if(t.State==="Paused"){
        t.State="Active";
        if(t.lastPause){
          const paused = new Date(now) - new Date(t.lastPause);
          t.TotalPausedMinutes = (t.TotalPausedMinutes||0) + (paused>0 ? Math.round(paused/60000) : 0);
        }
        t.lastStart=now; (t.Audit ||= []).push({type:"Resume",time:now});
      }
      save(); render();
    }catch(e){ console.error("startTask error", e); }
  }
  function pauseTask(uid){
    try{
      const t = tasks.find(x=>x.TaskUID===uid); if(!t || t.State!=="Active") return;
      pauseUID = uid;
      pauseTaskName.textContent = t.TaskName;
      pauseReason.value = ""; pauseNotes.value = "";
      pauseDialog.showModal();
    }catch(e){ console.error("pauseTask error", e); }
  }
  function finishTask(uid){
    try{
      const t = tasks.find(x=>x.TaskUID===uid); if(!t) return;
      const now = new Date().toISOString();
      if(t.State==="Active" && t.lastStart){
        const active = new Date(now) - new Date(t.lastStart);
        t.TotalActiveMinutes = (t.TotalActiveMinutes||0) + (active>0 ? Math.round(active/60000) : 0);
      }
      if(t.State==="Paused" && t.lastPause){
        const paused = new Date(now) - new Date(t.lastPause);
        t.TotalPausedMinutes = (t.TotalPausedMinutes||0) + (paused>0 ? Math.round(paused/60000) : 0);
      }
      t.State="Finished"; t.ActualFinish=now; t.lastStart=null; t.lastPause=null;
      (t.Audit ||= []).push({type:"Finish",time:now});
      save(); render();
    }catch(e){ console.error("finishTask error", e); }
  }
  window.startTask = startTask;
  window.pauseTask = pauseTask;
  window.finishTask = finishTask;

  tbody?.addEventListener("click", (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn || !tbody.contains(btn)) return;
    const uid = btn.dataset.uid;
    if (!uid) return;
    const action = btn.dataset.action;
    if (action === "start") {
      startTask(uid);
    } else if (action === "pause") {
      pauseTask(uid);
    } else if (action === "finish") {
      finishTask(uid);
    }
  });

  confirmPause?.addEventListener("click",(e)=>{
    e.preventDefault();
    if(!pauseReason.value) return;
    try{
      const t = tasks.find(x=>x.TaskUID===pauseUID); if(!t) return;
      const now = new Date().toISOString();
      if(t.State==="Active" && t.lastStart){
        const active = new Date(now) - new Date(t.lastStart);
        t.TotalActiveMinutes = (t.TotalActiveMinutes||0) + (active>0 ? Math.round(active/60000) : 0);
      }
      t.State="Paused"; t.lastStart=null; t.lastPause=now;
      (t.Audit ||= []).push({type:"Pause",time:now,reason:pauseReason.value,notes:pauseNotes.value||""});

      appendDelayLog({
        LoggedAt: now,
        TaskUID: t.TaskUID,
        TaskName: t.TaskName,
        SummaryTaskName: t.SummaryTaskName || "",
        Department: t.Department || "",
        PlannedStart: t.PlannedStart || t.PlannedStartRaw || "",
        ActualStart: t.ActualStart || "",
        Reason: pauseReason.value,
        Notes: pauseNotes.value || ""
      });

      save();
      pauseDialog.close();
      render();
    }catch(err){
      console.error("confirmPause error", err);
    }
  });

  // ========= Render (3-day window) =========
  function windowRange3d(){
    const now=new Date();
    const start=new Date(now.getFullYear(),now.getMonth(),now.getDate(),0,0,0,0);
    const end=new Date(start.getTime()+3*24*3600*1000-1);
    return {start,end};
  }
  function parseMillisFlexible(value){
    if (!value) return NaN;
    const d = new Date(value);
    if (!isNaN(d)) return d.getTime();
    const parsed = Date.parse(value);
    return isNaN(parsed) ? NaN : parsed;
  }
  function fmt(ts, fallback=""){ 
    if (ts){
      const d=new Date(ts);
      if(!isNaN(d)) return d.toLocaleString();
    }
    if (fallback){
      const d = new Date(fallback);
      if(!isNaN(d)) return d.toLocaleString();
      return fallback;
    }
    return "";
  }

  function render(){
    if (!tbody) return;
    const {start,end}=windowRange3d();
    const winStart = start.getTime();
    const winEnd = end.getTime();
    const filtered = tasks
      .filter(t => {
        const ps = parseMillisFlexible(t.PlannedStart || t.PlannedStartRaw);
        const pf = parseMillisFlexible(t.PlannedFinish || t.PlannedFinishRaw);
        if (isNaN(ps) || isNaN(pf)) return true; // still show tasks if no dates parsed
        return ps <= winEnd && pf >= winStart;
      })
      .sort((a,b)=>{
        const aTime = parseMillisFlexible(a.PlannedStart || a.PlannedStartRaw);
        const bTime = parseMillisFlexible(b.PlannedStart || b.PlannedStartRaw);
        if (isNaN(aTime) && isNaN(bTime)) return 0;
        if (isNaN(aTime)) return 1;
        if (isNaN(bTime)) return -1;
        return aTime - bTime;
      });

    tbody.innerHTML="";
    filtered.forEach(t=>{
      const stateBadge = t.State!=="Idle" ? `<span class="state-badge state-${t.State.toLowerCase()}">${t.State}</span>` : "";
      const tr=document.createElement("tr");
      tr.innerHTML = `
        <td>${t.TaskName || ""} ${stateBadge}</td>
        <td>${t.SummaryTaskName||""}</td>
        <td>${fmt(t.PlannedStart, t.PlannedStartRaw)}</td>
        <td>${fmt(t.ActualStart)}</td>
        <td>${t.Department||""}</td>
        <td class="actions"></td>
      `;
      const actionsCell = tr.querySelector(".actions");
      const btnRow=document.createElement("div");
      btnRow.className="btnrow";

      const startBtn=document.createElement("button");
      startBtn.className="primary";
      startBtn.dataset.action="start";
      startBtn.dataset.uid=t.TaskUID;
      startBtn.textContent = t.State==="Paused"?"Resume":"Start";
      startBtn.disabled = t.State==="Active";
      btnRow.appendChild(startBtn);

      const pauseBtn=document.createElement("button");
      pauseBtn.dataset.action="pause";
      pauseBtn.dataset.uid=t.TaskUID;
      pauseBtn.textContent="Pause";
      pauseBtn.disabled = t.State!=="Active";
      btnRow.appendChild(pauseBtn);

      const finishBtn=document.createElement("button");
      finishBtn.className="success";
      finishBtn.dataset.action="finish";
      finishBtn.dataset.uid=t.TaskUID;
      finishBtn.textContent="Finish";
      finishBtn.disabled = !(t.State==="Active"||t.State==="Paused");
      btnRow.appendChild(finishBtn);

      actionsCell.appendChild(btnRow);
      tbody.appendChild(tr);
    });

    const notice = document.getElementById("notice");
    if (notice){
      notice.textContent = tasks.length
        ? "Showing a 3-day forecast (today → +2 days)."
        : "Import a Microsoft Project CSV or XML to begin. Showing a 3-day forecast (today → +2 days).";
    }
  }
});
