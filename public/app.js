// Live Project Tracker — CSV + MSP XML importer (robust header + namespace-safe)
// Columns: Task Name | Task Summary Name | Scheduled Start | Actual Start | Assigned Department | Actions
window.addEventListener("DOMContentLoaded", () => {
  console.log("%c[Tracker] app.js loaded (robust CSV+XML)", "color:#6aa3ff");

  // ---- DOM ----
  const importBtn = document.getElementById("importBtn");
  const fileInput  = document.getElementById("fileInput");
  const exportBtn  = document.getElementById("exportBtn");
  const tbody      = document.querySelector("#taskTable tbody");

  // Pause dialog
  const pauseDialog   = document.getElementById("pauseDialog");
  const pauseReason   = document.getElementById("pauseReason");
  const pauseNotes    = document.getElementById("pauseNotes");
  const pauseTaskName = document.getElementById("pauseTaskName");
  const confirmPause  = document.getElementById("confirmPause");

  // ---- State ----
  let tasks = [];
  let pauseUID = null;

  // ---- Delay log (localStorage) ----
  const DELAY_LOG_KEY = "DELAY_LOG_V1";
  const readDelayLog = () => { try { return JSON.parse(localStorage.getItem(DELAY_LOG_KEY) || "[]"); } catch { return []; } };
  const writeDelayLog = (arr) => localStorage.setItem(DELAY_LOG_KEY, JSON.stringify(arr));
  const appendDelayLog = (e) => writeDelayLog([...readDelayLog(), e]);

  // Clear button is inline in HTML
  window.clearProject = () => {
    if (!confirm("Clear current project data?")) return;
    tasks = [];
    const notice = document.getElementById("notice");
    if (notice) notice.textContent = "Import a Microsoft Project CSV or XML to begin. Showing a 3-day forecast (today → +2 days).";
    if (fileInput) fileInput.value = "";
    render();
    console.log("[Tracker] project cleared");
  };

  // ---- CSV helpers (VERY tolerant) ----
  // Normalize header: strip BOM, lowercase, replace underscores with spaces, collapse spaces, remove surrounding punctuation.
  function normHeader(h){
    return (h || "")
      .replace(/^\uFEFF/, "")       // BOM
      .replace(/[^\S\r\n]+/g, " ")  // whitespace to single space
      .replace(/_/g, " ")           // underscores -> spaces
      .toLowerCase()
      .replace(/\s+/g, " ")         // collapse spaces
      .trim();
  }
  function detectDelimiter(firstLine){
    const c=(firstLine.match(/,/g)||[]).length;
    const s=(firstLine.match(/;/g)||[]).length;
    const t=(firstLine.match(/\t/g)||[]).length;
    if (t > c && t > s) return "\t";
    return s>c?';':',';
  }
  function parseCSV(text){
    const lines=text.split(/\r?\n/).filter(l=>l.trim().length);
    if(!lines.length) throw new Error("Empty CSV");
    const delim = detectDelimiter(lines[0]);
    const headersRaw = lines[0].split(delim);
    const headers = headersRaw.map(h=>h.replace(/^\uFEFF/,''));
    const rows    = lines.slice(1).map(l=>l.split(delim));
    return {headers, rows, delim};
  }

  // Canonical names -> list of aliases; we match AFTER normHeader()
  const HEADER_ALIASES = {
    "unique id": ["unique id","uniqueid","task unique id","uid","id"],
    "name": ["name","task name","taskname"],
    "summary": ["summary","is summary","issummary","summary flag"],
    "outline level": ["outline level","outlinelevel","level"],
    "wbs": ["wbs"],
    "start": ["start","start date","start time","startdate","scheduled start","planned start","start_date","start time"],
    "finish": ["finish","finish date","finish time","finishdate","scheduled finish","planned finish","finish_date","finish time"],
    "% complete": ["% complete","percent complete","percentcomplete","%complete","percent_complete"],
    "resource names": ["resource names","resources","resource name","resourcename","resource_names"],
    "text5": ["text5","department","dept","dept code"],
    "text30": ["text30","department","dept","assigned department","assigned_department"]
  };

  function indexOfAlias(headers, canonical){
    const wants = (HEADER_ALIASES[canonical] || [canonical]).map(normHeader);
    const normalized = headers.map(normHeader);
    return normalized.findIndex(h => wants.includes(h));
  }

  function buildColumnMap(headers){
    const col = {
      uid : indexOfAlias(headers,"unique id"),
      name: indexOfAlias(headers,"name"),
      summary:indexOfAlias(headers,"summary"),
      outlineLevel:indexOfAlias(headers,"outline level"),
      wbs:indexOfAlias(headers,"wbs"),
      start:indexOfAlias(headers,"start"),
      finish:indexOfAlias(headers,"finish"),
      pct:indexOfAlias(headers,"% complete"),
      res:indexOfAlias(headers,"resource names"),
      text5:indexOfAlias(headers,"text5"),
      text30:indexOfAlias(headers,"text30")
    };
    const must=["uid","name","summary","outlineLevel","wbs","start","finish","pct"];
    const missing=must.filter(k=>col[k]===-1);
    if(missing.length){
      throw new Error(`Missing required columns: ${missing.join(", ")}\nFound: ${headers.join(" | ")}`);
    }
    return col;
  }
  function pickDepartmentFromCSV(cells, col){
    const t30 = col.text30!==-1 ? (cells[col.text30]||"").trim() : "";
    const t5  = col.text5  !==-1 ? (cells[col.text5 ]||"").trim() : "";
    if(t30) return t30;
    if(t5)  return t5;
    const res = col.res!==-1 ? (cells[col.res]||"").split(",")[0].trim() : "";
    return res || "";
  }

  // ---- Namespace-safe XML helpers (MSPDI)
  // CSS selectors don’t play nice with default namespaces. Use localName-based queries.
  function byLocalName(root, name){
    const out=[];
    const all = root.getElementsByTagName("*");
    for(let i=0;i<all.length;i++){
      if (all[i].localName === name) out.push(all[i]);
    }
    return out;
  }
  function oneLocal(root, name){
    const arr = byLocalName(root, name);
    return arr.length ? arr[0] : null;
  }
  function textOf(el, name){
    const n = oneLocal(el, name);
    return n ? (n.textContent || "").trim() : "";
  }

  function parseMSPXML(text){
    const doc = new DOMParser().parseFromString(text, "application/xml");
    // Check for parsererror
    if (doc.getElementsByTagName("parsererror").length){
      throw new Error("XML parse error");
    }
    const project = oneLocal(doc, "Project");
    if (!project) throw new Error("Not a valid Microsoft Project XML (MSPDI)");

    // ExtendedAttribute definitions: FieldID -> Alias
    const defMap = new Map();
    const extDefs = byLocalName(project, "ExtendedAttribute");
    extDefs.forEach(def=>{
      // Only the ones under <ExtendedAttributes> at project level have FieldID+Alias
      const parent = def.parentElement;
      if (parent && parent.localName === "ExtendedAttributes" && parent.parentElement === project){
        const id = textOf(def, "FieldID");
        const alias = textOf(def, "Alias");
        if (id) defMap.set(id, alias||"");
      }
    });

    function pickDepartmentFromXML(taskEl){
      // Task-level ExtendedAttribute children
      const taskAttrs = byLocalName(taskEl, "ExtendedAttribute");
      let candidate = "";
      taskAttrs.forEach(a=>{
        // <FieldID> under this ExtendedAttribute
        const id = textOf(a, "FieldID");
        const val = textOf(a, "Value");
        const alias = id ? (defMap.get(id) || "") : "";
        if (!candidate && alias && /department/i.test(alias) && val) candidate = val;
        // Heuristic: Text30 = FieldID 188743734 (common MSP mapping)
        if (!candidate && id === "188743734" && val) candidate = val;
      });
      if (candidate) return candidate;
      const rn = textOf(taskEl, "ResourceNames");
      if (rn) return rn.split(",")[0].trim();
      return "";
    }

    const out = [];
    const tasksEl = oneLocal(project, "Tasks");
    if (!tasksEl) return out;

    const stack = [];
    const taskNodes = byLocalName(tasksEl, "Task");
    taskNodes.forEach(taskEl=>{
      const uid   = textOf(taskEl, "UID");
      const name  = textOf(taskEl, "Name");
      const summary = textOf(taskEl, "Summary") === "1";
      const olvl = parseInt(textOf(taskEl, "OutlineLevel") || "1", 10) || 1;
      const start = textOf(taskEl, "Start");
      const finish= textOf(taskEl, "Finish");
      const pct   = parseInt(textOf(taskEl, "PercentComplete") || "0", 10) || 0;

      stack[olvl] = name;
      stack.length = olvl + 1;

      if (summary) return; // skip summary rows in table
      const summaryName = olvl > 1 ? (stack[olvl-1] || "") : "";

      out.push({
        TaskUID: uid,
        TaskName: name,
        SummaryTaskName: summaryName,
        Department: pickDepartmentFromXML(taskEl),
        PlannedStart: start ? new Date(start).toISOString() : "",
        PlannedFinish: finish ? new Date(finish).toISOString() : "",
        PercentComplete: pct,

        State: "Idle",
        ActualStart: null, ActualFinish: null,
        TotalActiveMinutes: 0, TotalPausedMinutes: 0,
        lastStart: null, lastPause: null,
        Audit: []
      });
    });

    console.log(`[Tracker] XML import: ${out.length} tasks`);
    return out;
  }

  // ---- Time & view helpers ----
  function windowRange3d(){
    const now=new Date();
    const start=new Date(now.getFullYear(),now.getMonth(),now.getDate(),0,0,0,0);
    const end=new Date(start.getTime()+3*24*3600*1000-1); // end of day today+2
    return {start,end};
  }
  function overlaps(ps,pf,win){ return ps<=win.end.getTime() && pf>=win.start.getTime(); }
  function fmt(ts){ if(!ts) return ""; const d=new Date(ts); return isNaN(d)? "": d.toLocaleString(); }

  // ---- Actions / FSM ----
  function startTask(uid){
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
    render();
  }
  function pauseTask(uid){
    const t = tasks.find(x=>x.TaskUID===uid); if(!t || t.State!=="Active") return;
    pauseUID = uid;
    pauseTaskName.textContent = t.TaskName;
    pauseReason.value = ""; pauseNotes.value = "";
    pauseDialog.showModal();
  }
  function finishTask(uid){
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
    render();
  }
  window.startTask = startTask;
  window.pauseTask = pauseTask;
  window.finishTask = finishTask;

  confirmPause.addEventListener("click",(e)=>{
    e.preventDefault();
    if(!pauseReason.value) return;
    const t = tasks.find(x=>x.TaskUID===pauseUID); if(!t) return;
    const now = new Date().toISOString();
    if(t.State==="Active" && t.lastStart){
      const active = new Date(now) - new Date(t.lastStart);
      t.TotalActiveMinutes = (t.TotalActiveMinutes||0) + (active>0 ? Math.round(active/60000) : 0);
    }
    t.State="Paused"; t.lastStart=null; t.lastPause=now;
    (t.Audit ||= []).push({type:"Pause",time:now,reason:pauseReason.value,notes:pauseNotes.value||""});

    // Save to Delay Log
    appendDelayLog({
      LoggedAt: now,
      TaskUID: t.TaskUID,
      TaskName: t.TaskName,
      SummaryTaskName: t.SummaryTaskName || "",
      Department: t.Department || "",
      PlannedStart: t.PlannedStart || "",
      ActualStart: t.ActualStart || "",
      Reason: pauseReason.value,
      Notes: pauseNotes.value || ""
    });

    pauseDialog.close(); render();
  });

  // ---- Import / Export ----
  importBtn.addEventListener("click", ()=>fileInput.click());
  fileInput.addEventListener("change", async (e)=>{
    const file=e.target.files[0]; if(!file) return;
    const text = await file.text();
    const isXML = /\.xml$/i.test(file.name) || /xml/.test(file.type);

    try{
      tasks = isXML ? parseMSPXML(text) : parseCSVToTasks(text);
      console.log(`[Tracker] Imported ${tasks.length} tasks from ${isXML ? "XML" : "CSV"}`);
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
    const stack=[]; const out=[];
    for(const cells of parsed.rows){
      if (!cells || cells.length===0) continue;
      const isSummaryStr = ((cells[col.summary]||"")+"").trim().toLowerCase();
      const isSummary = isSummaryStr.startsWith("y") || isSummaryStr==="true" || isSummaryStr==="1";
      const level = parseInt((cells[col.outlineLevel]||"1"),10) || 1;
      const name  = (cells[col.name]||"").trim();

      stack[level]=name; stack.length=level+1;
      if(isSummary) continue;

      const summaryName = level>1 ? (stack[level-1]||"") : "";
      out.push({
        TaskUID:(cells[col.uid]||"").trim(),
        TaskName:name,
        SummaryTaskName:summaryName,
        Department:pickDepartmentFromCSV(cells,col),
        PlannedStart: cells[col.start] ? new Date(cells[col.start]).toISOString() : "",
        PlannedFinish: cells[col.finish] ? new Date(cells[col.finish]).toISOString() : "",
        PercentComplete: parseInt((cells[col.pct]||"0"),10)||0,

        State:"Idle",
        ActualStart:null, ActualFinish:null,
        TotalActiveMinutes:0, TotalPausedMinutes:0,
        lastStart:null, lastPause:null,
        Audit:[]
      });
    }
    return out;
  }

  exportBtn.addEventListener("click", ()=>{
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

  // ---- Render (3-day window) ----
  function render(){
    const {start,end}=windowRange3d();
    const filtered = tasks
      .filter(t => {
        const ps = new Date(t.PlannedStart || 0).getTime();
        const pf = new Date(t.PlannedFinish || 0).getTime();
        if (!ps || !pf) return true; // show tasks even if dates missing
        return overlaps(ps,pf,{start,end});
      })
      .sort((a,b)=> new Date(a.PlannedStart||0) - new Date(b.PlannedStart||0));

    tbody.innerHTML="";
    filtered.forEach(t=>{
      const stateBadge = t.State!=="Idle" ? `<span class="state-badge state-${t.State.toLowerCase()}">${t.State}</span>` : "";
      const tr=document.createElement("tr");
      tr.innerHTML = `
        <td>${t.TaskName || ""} ${stateBadge}</td>
        <td>${t.SummaryTaskName||""}</td>
        <td>${fmt(t.PlannedStart)}</td>
        <td>${fmt(t.ActualStart)}</td>
        <td>${t.Department||""}</td>
        <td class="actions">
          <button class="primary" ${t.State==="Active"?"disabled":""} onclick="startTask('${t.TaskUID}')">${t.State==="Paused"?"Resume":"Start"}</button>
          <button ${t.State==="Active"?"":"disabled"} onclick="pauseTask('${t.TaskUID}')">Pause</button>
          <button class="success" ${t.State==="Active"||t.State==="Paused"?"":"disabled"} onclick="finishTask('${t.TaskUID}')">Finish</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    const notice = document.getElementById("notice");
    notice.textContent = tasks.length
      ? "Showing a 3-day forecast (today → +2 days)."
      : "Import a Microsoft Project CSV or XML to begin. Showing a 3-day forecast (today → +2 days).";
  }
});
