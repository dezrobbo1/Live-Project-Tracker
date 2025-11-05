// Live Project Tracker — robust CSV + MSP XML import, Text30-only department, Actions restored
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

  // ---- Delay log (localStorage) ----
  const DELAY_LOG_KEY = "DELAY_LOG_V1";
  const readDelayLog  = () => { try { return JSON.parse(localStorage.getItem(DELAY_LOG_KEY)||"[]"); } catch { return []; } };
  const writeDelayLog = (arr) => localStorage.setItem(DELAY_LOG_KEY, JSON.stringify(arr));
  const appendDelayLog= (entry) => { const a=readDelayLog(); a.push(entry); writeDelayLog(a); };

  // Clear button (called inline from index.html)
  window.clearProject = () => {
    if (!confirm("Clear current project data?")) return;
    tasks = [];
    const notice = document.getElementById("notice");
    if (notice) notice.textContent = "Import a Microsoft Project CSV or XML to begin. Showing a 3-day forecast (today → +2 days).";
    if (fileInput) fileInput.value = "";
    render();
    console.log("[Tracker] project cleared");
  };

  // ========= CSV helpers =========
  function normHeader(h){
    return (h||"")
      .replace(/^[\uFEFF\u200B]+/, "")
      .replace(/[_-]+/g, " ")
      .replace(/[^\p{L}\p{N}% ]+/gu, "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  const HEADER_ALIASES = {
    "unique id": ["unique id","uniqueid","task unique id","uid"],
    "name": ["name","task name","taskname"],
    "summary": ["summary","is summary","issummary"],
    "outline level": ["outline level","outlinelevel","level","outline lvl","outline"],
    "wbs": ["wbs"],
    "start": ["start","start date","start time","startdate","start datetime","start date time"],
    "finish": ["finish","finish date","finish time","finishdate","finish datetime","finish date time"],
    "% complete": ["% complete","percent complete","percentcomplete","percent","pct complete"],
    "resource names": ["resource names","resources","resource name","resourcename"],
    "text5": ["text5","department","dept"],
    "text30": ["text30","assigned department","department","dept"]
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
      text5:indexOfAlias(headers,"text5"),
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

  // ======= Date parsing for MSP CSV =======
  function parseDateFlexible(s){
    if (!s) return "";
    s = String(s).trim();
    const d0 = new Date(s);
    if (!isNaN(d0)) return d0.toISOString();

    // dd/MM/yyyy HH:mm or MM/dd/yyyy HH:mm
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m){
      let d = parseInt(m[1],10), M = parseInt(m[2],10), y = parseInt(m[3],10);
      const hh = parseInt(m[4]||"0",10), mm = parseInt(m[5]||"0",10), ss = parseInt(m[6]||"0",10);
      const dayFirst = true; // AU default
      const day = dayFirst ? d : M;
      const mon = dayFirst ? M-1 : d-1;
      if (y < 100) y += 2000;
      const dt = new Date(y, mon, day, hh, mm, ss);
      if (!isNaN(dt)) return dt.toISOString();
    }
    return "";
  }

  // ========= MSP XML (namespace-safe) =========
  function ql(root, tag){
    const out=[]; const all=root.getElementsByTagName("*");
    for(let i=0;i<all.length;i++){ if(all[i].localName===tag) out.push(all[i]); }
    return out;
  }
  function firstText(el, tag){
    const found = ql(el, tag)[0];
    return found ? (found.textContent||"").trim() : "";
  }
  function parseMSPXML(text){
    const doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length){
      throw new Error("XML parse error");
    }
    const projectEls = ql(doc, "Project");
    if (!projectEls.length) throw new Error("Not a valid Microsoft Project XML (MSPDI).");

    // ExtendedAttribute definitions: FieldID -> Alias
    const defMap = new Map();
    ql(doc, "ExtendedAttributes").forEach(node=>{
      ql(node,"ExtendedAttribute").forEach(def=>{
        const id = firstText(def, "FieldID");
        const alias = firstText(def, "Alias");
        if (id) defMap.set(id, alias || "");
      });
    });

    // Text30-only department helper
    function departmentFromXML(taskEl){
      let result = "";
      ql(taskEl,"ExtendedAttribute").forEach(a=>{
        const id = firstText(a,"FieldID");
        const val= firstText(a,"Value");
        // Text30 heuristic: FieldID 188743734 is common for Text30 in MSP.
        if (!result && id === "188743734" && val) result = val;
        // Also accept Alias that equals "Assigned Department" (exact case-insensitive)
        const alias = id ? (defMap.get(id)||"") : "";
        if (!result && alias && /^assigned department$/i.test(alias) && val) result = val;
      });
      return result; // no fallback to Resource Names
    }

    // Maintain a stack of summary task names at each outline level
    const summaryStack = [];
    const out = [];

    ql(doc,"Tasks").forEach(tasksNode=>{
      ql(tasksNode,"Task").forEach(taskEl=>{
        const uid   = firstText(taskEl,"UID");
        const name  = firstText(taskEl,"Name");
        const summaryFlag = (firstText(taskEl,"Summary") || "0") === "1";
        const olvl = parseInt(firstText(taskEl,"OutlineLevel") || "1", 10) || 1;
        const start = firstText(taskEl,"Start");
        const finish= firstText(taskEl,"Finish");
        const pct   = parseInt(firstText(taskEl,"PercentComplete") || "0", 10) || 0;

        if (summaryFlag){
          summaryStack[olvl] = name;
          summaryStack.length = Math.max(summaryStack.length, olvl+1);
          return;
        }

        const parentSummaryName = olvl > 1 ? (summaryStack[olvl-1] || "") : "";

        out.push({
          TaskUID: uid,
          TaskName: name,
          SummaryTaskName: parentSummaryName,
          Department: departmentFromXML(taskEl),
          PlannedStart: start ? new Date(start).toISOString() : "",
          PlannedFinish: finish ? new Date(finish).toISOString() : "",
          PercentComplete: pct,

          State:"Idle",
          ActualStart:null, ActualFinish:null,
          TotalActiveMinutes:0, TotalPausedMinutes:0,
          lastStart:null, lastPause:null,
          Audit:[]
        });
      });
    });
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

    // summaryStack holds ONLY summary task names per level
    const summaryStack = [];
    const out = [];

    for(const cells of parsed.rows){
      const isSummaryStr = ((cells[col.summary]||"")+"").trim().toLowerCase();
      const isSummary = isSummaryStr.startsWith("y") || isSummaryStr==="true" || isSummaryStr==="1";
      const level = parseInt((cells[col.outlineLevel]||"1"),10) || 1;
      const name  = (cells[col.name]||"").trim();

      if (isSummary){
        summaryStack[level] = name;
        summaryStack.length = Math.max(summaryStack.length, level+1);
        continue;
      }

      const parentSummaryName = level>1 ? (summaryStack[level-1] || "") : "";

      // Text30-only department (no fallback)
      const dept = col.text30 !== -1 ? (cells[col.text30] || "").trim() : "";

      out.push({
        TaskUID:(cells[col.uid]||"").trim(),
        TaskName:name,
        SummaryTaskName: parentSummaryName,
        Department: dept,
        PlannedStart: parseDateFlexible(cells[col.start]),
        PlannedFinish: parseDateFlexible(cells[col.finish]),
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
