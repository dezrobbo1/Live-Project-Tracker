// Live Project Tracker — robust CSV + MSP XML import
// View columns: Task Name | Task Summary Name | Scheduled Start | Actual Start | Assigned Department
window.addEventListener("DOMContentLoaded", () => {
  console.log("%c[Tracker] app.js (robust CSV + XML, no Actions column)", "color:#6aa3ff");

  // ---- DOM ----
  const importBtn = document.getElementById("importBtn");
  const fileInput  = document.getElementById("fileInput");
  const exportBtn  = document.getElementById("exportBtn");
  const tbody      = document.querySelector("#taskTable tbody");

  // Pause dialog (kept for future; not used when Actions hidden)
  const pauseDialog   = document.getElementById("pauseDialog");
  const pauseReason   = document.getElementById("pauseReason");
  const pauseNotes    = document.getElementById("pauseNotes");
  const pauseTaskName = document.getElementById("pauseTaskName");
  const confirmPause  = document.getElementById("confirmPause");

  // ---- State ----
  let tasks = [];

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
    "text30": ["text30","department","dept"]
  };

  function detectDelimiter(firstLine){
    const candidates = [",",";","\t","|"];
    const counts = candidates.map(ch => (firstLine.match(new RegExp(`\\${ch}`,"g"))||[]).length);
    let bestIdx = 0; for (let i=1;i<counts.length;i++) if (counts[i]>counts[bestIdx]) bestIdx=i;
    return candidates[bestIdx] || ",";
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
    // some flexible fallbacks:
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

  function pickDepartmentFromCSV(cells, col){
    const t30 = col.text30!==-1 ? (cells[col.text30]||"").trim() : "";
    const t5  = col.text5  !==-1 ? (cells[col.text5 ]||"").trim() : "";
    if(t30) return t30;
    if(t5)  return t5;
    const res = col.res!==-1 ? (cells[col.res]||"").split(",")[0].trim() : "";
    return res || "";
  }

  // ======= Flexible date parser for MSP exports (CSV) =======
  function parseDateFlexible(s){
    if (!s) return "";
    s = String(s).trim();
    // First try native
    const d0 = new Date(s);
    if (!isNaN(d0)) return d0.toISOString();

    // Try split forms: dd/MM/yyyy HH:mm or MM/dd/yyyy HH:mm (24h or 12h)
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (m){
      let d = parseInt(m[1],10), M = parseInt(m[2],10), y = parseInt(m[3],10);
      const hh = parseInt(m[4]||"0",10), mm = parseInt(m[5]||"0",10), ss = parseInt(m[6]||"0",10);
      // If first number > 12, treat as day-first; else assume day-first by default (common in AU)
      const dayFirst = (d>12) || true;
      const day = dayFirst ? d : M;
      const mon = dayFirst ? M-1 : d-1;
      if (y < 100) y += 2000;
      const dt = new Date(y, mon, day, hh, mm, ss);
      if (!isNaN(dt)) return dt.toISOString();
    }

    // If all else fails, return empty so we still display the row
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

    const defMap = new Map(); // FieldID -> Alias
    ql(doc, "ExtendedAttributes").forEach(node=>{
      ql(node,"ExtendedAttribute").forEach(def=>{
        const id = firstText(def, "FieldID");
        const alias = firstText(def, "Alias");
        if (id) defMap.set(id, alias || "");
      });
    });

    function pickDepartmentFromXML(taskEl){
      let candidate = "";
      ql(taskEl,"ExtendedAttribute").forEach(a=>{
        const id = firstText(a,"FieldID");
        const val= firstText(a,"Value");
        const alias = id ? (defMap.get(id)||"") : "";
        if (!candidate && alias && /department/i.test(alias) && val) candidate = val;
        if (!candidate && id === "188743734" && val) candidate = val; // common Text30 FieldID
      });
      if (candidate) return candidate;
      const rn = firstText(taskEl,"ResourceNames");
      if (rn) return rn.split(",")[0].trim();
      return "";
    }

    // Maintain a stack of **summary task names only** at each outline level
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

        // If it's a summary task, update stack and skip rendering row
        if (summaryFlag){
          summaryStack[olvl] = name;               // remember this summary's name
          summaryStack.length = Math.max(summaryStack.length, olvl+1);
          return;
        }

        const parentSummaryName = olvl > 1 ? (summaryStack[olvl-1] || "") : "";

        out.push({
          TaskUID: uid,
          TaskName: name,
          SummaryTaskName: parentSummaryName,
          Department: pickDepartmentFromXML(taskEl),
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

    // Maintain a stack of **summary task names only** at each outline level
    const summaryStack = [];
    const out = [];

    for(const cells of parsed.rows){
      const isSummaryStr = ((cells[col.summary]||"")+"").trim().toLowerCase();
      const isSummary = isSummaryStr.startsWith("y") || isSummaryStr==="true" || isSummaryStr==="1";
      const level = parseInt((cells[col.outlineLevel]||"1"),10) || 1;
      const name  = (cells[col.name]||"").trim();

      if (isSummary){
        summaryStack[level] = name;                   // record this parent summary
        summaryStack.length = Math.max(summaryStack.length, level+1);
        continue;                                     // do not render summary rows
      }

      const parentSummaryName = level>1 ? (summaryStack[level-1] || "") : "";

      out.push({
        TaskUID:(cells[col.uid]||"").trim(),
        TaskName:name,
        SummaryTaskName: parentSummaryName,
        Department:pickDepartmentFromCSV(cells,col),
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
      `;
      tbody.appendChild(tr);
    });

    const notice = document.getElementById("notice");
    notice.textContent = tasks.length
      ? "Showing a 3-day forecast (today → +2 days)."
      : "Import a Microsoft Project CSV or XML to begin. Showing a 3-day forecast (today → +2 days).";
  }
});
