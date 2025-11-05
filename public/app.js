// Live Project Tracker — CSV + MSP XML import
// View: Task Name | Task Summary Name | Scheduled Start | Actual Start | Assigned Department | Actions
window.addEventListener("DOMContentLoaded", () => {
  console.log("%c[Tracker] app.js (actions ON, Text30-only dept)", "color:#6aa3ff");

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

  // Delay Log
  const DELAY_LOG_KEY = "DELAY_LOG_V1";
  const readDelayLog  = () => { try { return JSON.parse(localStorage.getItem(DELAY_LOG_KEY)||"[]"); } catch { return []; } };
  const writeDelayLog = (arr) => localStorage.setItem(DELAY_LOG_KEY, JSON.stringify(arr));
  const appendDelayLog= (entry) => { const a=readDelayLog(); a.push(entry); writeDelayLog(a); };

  window.clearProject = () => {
    if (!confirm("Clear current project data?")) return;
    tasks = [];
    const notice = document.getElementById("notice");
    if (notice) notice.textContent = "Import a Microsoft Project CSV or XML to begin. Showing a 3-day forecast (today → +2 days).";
    if (fileInput) fileInput.value = "";
    render();
    console.log("[Tracker] project cleared");
  };

  // ========= CSV helpers (tolerant) =========
  function normHeader(h){
    return (h||"")
      .replace(/^[\uFEFF\u200B]+/, "")
      .replace(/[_-]+/g, " ")
      .replace(/[^\p{L}\p{N}%\. ]+/gu, "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }
  const HEADER_ALIASES = {
    "unique id": ["unique id","uniqueid","task unique id","uid","unique id."],
    "name": ["name","task name","taskname"],
    "summary": ["summary","is summary","issummary"],
    "outline level": ["outline level","outlinelevel","level","outline lvl","outline"],
    "wbs": ["wbs"],
    "start": ["start","start date","start time","startdate","start datetime","start date time"],
    "finish": ["finish","finish date","finish time","finishdate","finish datetime","finish date time"],
    "% complete": ["% complete","percent complete","percentcomplete","percent","pct complete","percent complete."],
    "resource names": ["resource names","resources","resource name","resourcename"],
    "text30": ["text30","assigned department","department","dept","text 30","text-30","text_30"]
  };
  function detectDelimiter(firstLine){
    const cands=[",",";","\t","|"];
    const counts=cands.map(ch => (firstLine.match(new RegExp(`\\${ch}`,"g"))||[]).length);
    let best=0; for(let i=1;i<counts.length;i++) if(counts[i]>counts[best]) best=i;
    return cands[best] || ",";
  }
  function parseCSV(text){
    const lines = text.split(/\r?\n/).filter(l => l.trim().length);
    if (!lines.length) throw new Error("Empty CSV");
    const delim = detectDelimiter(lines[0]);
    const headers = lines[0].split(delim).map(h=>h.replace(/^[\uFEFF\u200B]+/,""));
    const rows    = lines.slice(1).map(l => l.split(delim));
    return { headers, rows, delim };
  }
  function indexOfAlias(headers, canonical){
    const wants = (HEADER_ALIASES[canonical] || [canonical]).map(normHeader);
    const normalized = headers.map(normHeader);
    for (let i=0;i<normalized.length;i++){
      if (wants.includes(normalized[i])) return i;
    }
    // tolerant fallbacks
    for (let i=0;i<normalized.length;i++){
      const h = normalized[i];
      if (canonical==="start"  && (h==="start date"||h==="start time")) return i;
      if (canonical==="finish" && (h==="finish date"||h==="finish time")) return i;
      if (canonical==="% complete" && (h==="percent complete"||h==="percent")) return i;
      if (canonical==="outline level" && (h==="outline lvl"||h==="outline")) return i;
    }
    return -1;
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
      text30:indexOfAlias(headers,"text30")
    };
    const must=["uid","name","summary","outlineLevel","wbs","start","finish","pct"];
    const missing=must.filter(k=>col[k]===-1);
    if(missing.length){
      const seen = headers.map(h=>normHeader(h)).join(" | ");
      throw new Error(`Missing required columns: ${missing.join(", ")}\nFound (normalized): ${seen}`);
    }
    return col;
  }
  // AU-friendly + AM/PM + "05 Nov 2025 08:00"
  function parseDateFlexible(s){
    if (!s) return "";
    s = String(s).trim();
    // native
    const d0 = new Date(s);
    if (!isNaN(d0)) return d0.toISOString();
    // dd/MM/yyyy HH:mm[:ss][ AM/PM]
    let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?\s*([APap][Mm])?)?$/);
    if (m){
      let d = +m[1], M = +m[2]-1, y = +m[3]; if (y<100) y+=2000;
      let hh = +(m[4]||0), mm = +(m[5]||0), ss = +(m[6]||0);
      const ap = m[7];
      if (ap){ if (/pm/i.test(ap) && hh<12) hh+=12; if (/am/i.test(ap) && hh===12) hh=0; }
      const dt = new Date(y,M,d,hh,mm,ss); if (!isNaN(dt)) return dt.toISOString();
    }
    // 05 Nov 2025 08:00
    m = s.match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/);
    if (m){
      const monMap={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
      const d=+m[1], M=monMap[m[2].toLowerCase()], y=(+m[3]<100?+m[3]+2000:+m[3]);
      const hh=+(m[4]||0), mm=+(m[5]||0);
      const dt=new Date(y,M,d,hh,mm,0); if(!isNaN(dt)) return dt.toISOString();
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

    function departmentFromXML(taskEl){
      let result = "";
      ql(taskEl,"ExtendedAttribute").forEach(a=>{
        const id = firstText(a,"FieldID");
        const val= firstText(a,"Value");
        if (!result && id === "188743734" && val) result = val; // Text30 heuristic
        const alias = id ? (defMap.get(id)||"") : "";
        if (!result && alias && /^assigned department$/i.test(alias) && val) result = val;
      });
      return result; // no fallback
    }

    // Build a map of WBS -> Name for all tasks (including summaries)
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
      if (t.isSummary) continue;
      // parent via WBS (e.g., "1.2.3" -> "1.2")
      let parentSummaryName = "";
      if (t.wbs && t.wbs.includes(".")){
        const parentWBS = t.wbs.split(".").slice(0,-1).join(".");
        parentSummaryName = byWBS.get(parentWBS)?.name || "";
      }
      out.push({
        TaskUID: t.uid,
        TaskName: t.name,
        SummaryTaskName: parentSummaryName,
        Department: departmentFromXML(t.el),
        PlannedStart: t.start ? new Date(t.start).toISOString() : "",
        PlannedFinish: t.finish ? new Date(t.finish).toISOString() : "",
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
  importBtn.addEventListener("click", ()=>fileInput.click());
  fileInput.addEventListener("change", async (e)=>{
    const file=e.target.files[0]; if(!file) return;
    const text = await file.text();
    const isXML = /\.xml$/i.test(file.name) || /xml/.test(file.type);
    try{
      tasks = isXML ? parseMSPXML(text) : parseCSVToTasks(text);
      console.log(`[Tracker] imported ${tasks.length} task rows from ${isXML?'XML':'CSV'}`);
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

    // First pass: build map WBS -> {name,isSummary,level}
    const rows = parsed.rows.map(cells => ({
      uid:(cells[col.uid]||"").trim(),
      name:(cells[col.name]||"").trim(),
      isSummary:/^(y|yes|true|1)$/i.test((cells[col.summary]||"").trim()),
      level:parseInt((cells[col.outlineLevel]||"1"),10)||1,
      wbs:(cells[col.wbs]||"").trim(),
      start:(cells[col.start]||""),
      finish:(cells[col.finish]||""),
      pct:parseInt((cells[col.pct]||"0"),10)||0,
      dept:(col.text30!==-1 ? (cells[col.text30]||"").trim() : "")
    }));
    const byWBS = new Map(rows.map(r=>[r.wbs,r]));

    // Second pass: emit only non-summaries, derive parent from WBS
    const out=[];
    for(const r of rows){
      if (r.isSummary) continue;
      let parentSummaryName="";
      if (r.wbs && r.wbs.includes(".")){
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

  // ========= Actions / FSM =========
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

  // ========= Render (3-day window) =========
  function windowRange3d(){
    const now=new Date();
    const start=new Date(now.getFullYear(),now.getMonth(),now.getDate(),0,0,0,0);
    const end=new Date(start.getTime()+3*24*3600*1000-1);
    return {start,end};
  }
  function overlaps(ps,pf,win){ return ps<=win.end.getTime() && pf>=win.start.getTime(); }
  function fmt(ts){ if(!ts) return ""; const d=new Date(ts); return isNaN(d)?"":d.toLocaleString(); }

  function render(){
    const {start,end}=windowRange3d();
    const filtered = tasks
      .filter(t => {
        const ps = new Date(t.PlannedStart || 0).getTime();
        const pf = new Date(t.PlannedFinish || 0).getTime();
        if (!ps || !pf) return true;
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
          <div class="btnrow">
            <button class="primary" ${t.State==="Active"?"disabled":""} onclick="startTask('${t.TaskUID}')">${t.State==="Paused"?"Resume":"Start"}</button>
            <button ${t.State==="Active"?"":"disabled"} onclick="pauseTask('${t.TaskUID}')">Pause</button>
            <button class="success" ${t.State==="Active"||t.State==="Paused"?"":"disabled"} onclick="finishTask('${t.TaskUID}')">Finish</button>
          </div>
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
