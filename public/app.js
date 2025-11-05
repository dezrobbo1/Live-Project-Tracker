(function(){
  const TASK_STORAGE_KEY = "LPT_TASKS_V2";
  const LEGACY_TASK_KEYS = ["PROJECT_TASKS_V1"];
  const DELAY_LOG_KEY = "LPT_DELAY_LOG_V1";
  const LEGACY_DELAY_KEYS = ["DELAY_LOG_V1"];

  const HEADER_ALIASES = {
    "unique id": ["unique id","uniqueid","task unique id","uid","unique id."],
    "name": ["name","task name","taskname"],
    "summary": ["summary","is summary","issummary"],
    "outline level": ["outline level","outlinelevel","level","outline lvl","outline"],
    "wbs": ["wbs"],
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
    "text30": ["text30","assigned department","department","dept","text 30","text-30","text_30"],
    "task summary name": ["task summary name","summary task name","parent summary","parent task"]
  };

  const defaultNotice = "Import a Microsoft Project CSV or XML to begin. Showing a 3-day forecast (today → +2 days).";

  const makeUID = () => {
    if (typeof crypto !== "undefined" && crypto.randomUUID){
      return crypto.randomUUID();
    }
    return `task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  };

  window.addEventListener("DOMContentLoaded", () => {
    const importBtn = document.getElementById("importBtn");
    const exportBtn = document.getElementById("exportBtn");
    const delayBtn = document.getElementById("delayBtn");
    const clearBtn = document.getElementById("clearBtn");
    const fileInput = document.getElementById("fileInput");
    const noticeEl = document.getElementById("notice");
    const tableBody = document.querySelector("#taskTable tbody");

    const pauseDialog = document.getElementById("pauseDialog");
    const pauseForm = document.getElementById("pauseForm");
    const pauseTaskName = document.getElementById("pauseTaskName");
    const pauseReason = document.getElementById("pauseReason");
    const pauseNotes = document.getElementById("pauseNotes");
    const cancelPause = document.getElementById("cancelPause");
    const dialogSupported = !!(pauseDialog && typeof pauseDialog.showModal === "function" && typeof pauseDialog.close === "function");

    if (!importBtn || !exportBtn || !delayBtn || !clearBtn || !fileInput || !tableBody) {
      console.warn("[Tracker] Required DOM nodes missing – aborting init");
      return;
    }

    let tasks = loadTasks();
    let pauseTargetUID = null;

    render();

    importBtn.addEventListener("click", () => fileInput.click());
    delayBtn.addEventListener("click", () => { window.location.href = "/delay.html"; });
    clearBtn.addEventListener("click", () => {
      if (!confirm("Clear current project data?")) return;
      tasks = [];
      saveTasks();
      updateNotice();
      renderTableRows([]);
    });

    exportBtn.addEventListener("click", () => {
      const csv = buildExportCSV(tasks);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shift_report_${formatDateForFile(new Date())}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    });

    fileInput.addEventListener("change", async (event) => {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      try {
        const text = await readFileSmart(file);
        const imported = await parseProjectFile(text, file.name || "");
        tasks = imported.map(normalizeTask);
        saveTasks();
        updateNotice();
        render();
      } catch (err) {
        console.error("[Tracker] Import failed", err);
        alert(err && err.message ? err.message : "Unable to import file");
      } finally {
        event.target.value = "";
      }
    });

    if (dialogSupported && pauseForm && pauseReason && pauseNotes && cancelPause){
      pauseForm.addEventListener("submit", (ev) => {
        ev.preventDefault();
        if (!pauseTargetUID) {
          pauseDialog.close();
          return;
        }
        const reason = (pauseReason.value || "").trim();
        const notes = (pauseNotes.value || "").trim();
        if (!reason) {
          pauseReason.focus();
          return;
        }
        applyPause(pauseTargetUID, reason, notes);
        pauseDialog.close();
      });

      cancelPause.addEventListener("click", () => {
        pauseDialog.close();
      });

      pauseDialog.addEventListener("close", () => {
        pauseTargetUID = null;
        pauseReason.value = "";
        pauseNotes.value = "";
      });
    }

    function loadTasks(){
      const current = readStorage(TASK_STORAGE_KEY) || [];
      if (Array.isArray(current) && current.length) return current.map(normalizeTask);
      for (const key of LEGACY_TASK_KEYS){
        const legacy = readStorage(key);
        if (Array.isArray(legacy) && legacy.length) return legacy.map(normalizeTask);
      }
      return [];
    }

    function saveTasks(){
      try {
        localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(tasks));
      } catch (err) {
        console.warn("[Tracker] Unable to save tasks", err);
      }
    }

    function loadDelayLog(){
      const current = readStorage(DELAY_LOG_KEY) || [];
      if (Array.isArray(current) && current.length) return sanitizeDelayEntries(current);
      for (const key of LEGACY_DELAY_KEYS){
        const legacy = readStorage(key);
        if (Array.isArray(legacy) && legacy.length) return sanitizeDelayEntries(legacy);
      }
      return [];
    }

    function saveDelayLog(entries){
      try {
        localStorage.setItem(DELAY_LOG_KEY, JSON.stringify(sanitizeDelayEntries(entries)));
      } catch (err) {
        console.warn("[Tracker] Unable to save delay log", err);
      }
    }

    function appendDelayLog(entry){
      const list = loadDelayLog();
      list.push(entry);
      saveDelayLog(list);
    }

    function render(){
      updateNotice();
      renderTableRows(filterTasks(tasks));
    }

    function filterTasks(list){
      if (!Array.isArray(list) || !list.length) return [];
      const startOfToday = new Date();
      startOfToday.setHours(0,0,0,0);
      const end = new Date(startOfToday);
      end.setDate(end.getDate() + 3);
      return [...list].sort(sortByPlannedStart).filter(task => {
        if (!task.PlannedStart) return true;
        const startMs = Date.parse(task.PlannedStart);
        if (isNaN(startMs)) return true;
        return startMs >= startOfToday.getTime() && startMs < end.getTime();
      });
    }

    function renderTableRows(rows){
      tableBody.innerHTML = "";
      rows.forEach(task => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${escapeHTML(task.TaskName)}</td>
          <td>${escapeHTML(task.SummaryTaskName)}</td>
          <td>${displayDate(task.PlannedStart, task.PlannedStartRaw)}</td>
          <td>${displayDate(task.ActualStart)}</td>
          <td>${escapeHTML(task.Department)}</td>
          <td class="actions"></td>
        `;
        const cell = tr.querySelector(".actions");
        const startBtn = document.createElement("button");
        startBtn.textContent = "Start";
        startBtn.type = "button";
        startBtn.disabled = task.State === "Running" || task.State === "Finished";
        startBtn.addEventListener("click", () => handleStart(task.TaskUID));

        const pauseBtn = document.createElement("button");
        pauseBtn.textContent = "Pause";
        pauseBtn.type = "button";
        pauseBtn.disabled = task.State !== "Running";
        pauseBtn.addEventListener("click", () => handlePause(task.TaskUID));

        const finishBtn = document.createElement("button");
        finishBtn.textContent = "Finish";
        finishBtn.type = "button";
        finishBtn.disabled = task.State === "Finished";
        finishBtn.addEventListener("click", () => handleFinish(task.TaskUID));

        cell.append(startBtn, pauseBtn, finishBtn);
        tableBody.appendChild(tr);
      });
    }

    function updateNotice(){
      if (!noticeEl) return;
      if (!tasks.length){
        noticeEl.textContent = defaultNotice;
        return;
      }
      const startOfToday = new Date();
      startOfToday.setHours(0,0,0,0);
      const end = new Date(startOfToday);
      end.setDate(end.getDate() + 2);
      const filtered = filterTasks(tasks);
      const formatter = new Intl.DateTimeFormat(undefined, { month:"short", day:"numeric" });
      noticeEl.textContent = `Showing ${filtered.length} of ${tasks.length} tasks (${formatter.format(startOfToday)} → ${formatter.format(end)}).`;
    }

    function handleStart(uid){
      const task = tasks.find(t => t.TaskUID === uid);
      if (!task) return;
      const nowIso = new Date().toISOString();
      if (!task.ActualStart) task.ActualStart = nowIso;
      if (task.State === "Paused" && task.lastPause){
        const pausedMinutes = minutesBetween(task.lastPause, nowIso);
        task.TotalPausedMinutes += pausedMinutes;
        task.lastPause = null;
      }
      task.State = "Running";
      task.lastStart = nowIso;
      task.Audit.push({ type:"start", at: nowIso });
      saveTasks();
      render();
    }

    function handlePause(uid){
      const task = tasks.find(t => t.TaskUID === uid);
      if (!task || task.State !== "Running") return;
      if (!dialogSupported || !pauseDialog || !pauseTaskName || !pauseReason || !pauseNotes){
        const reasonInput = prompt(`Pause "${task.TaskName}" — enter reason`);
        const reason = reasonInput ? reasonInput.trim() : "";
        if (!reason) return;
        const notesInput = prompt("Notes (optional)");
        const notes = notesInput ? notesInput.trim() : "";
        applyPause(uid, reason, notes);
        return;
      }
      pauseTargetUID = uid;
      pauseTaskName.textContent = task.TaskName || "";
      pauseReason.value = "";
      pauseNotes.value = "";
      pauseDialog.showModal();
    }

    function applyPause(uid, reason, notes){
      const task = tasks.find(t => t.TaskUID === uid);
      if (!task || task.State !== "Running") return;
      const nowIso = new Date().toISOString();
      if (task.lastStart){
        const activeMinutes = minutesBetween(task.lastStart, nowIso);
        task.TotalActiveMinutes += activeMinutes;
      }
      task.State = "Paused";
      task.lastStart = null;
      task.lastPause = nowIso;
      task.Audit.push({ type:"pause", at: nowIso, reason, notes });
      appendDelayLog({
        LoggedAt: nowIso,
        TaskUID: task.TaskUID,
        TaskName: task.TaskName,
        SummaryTaskName: task.SummaryTaskName,
        Department: task.Department,
        PlannedStart: task.PlannedStart,
        ActualStart: task.ActualStart,
        Reason: reason,
        Notes: notes
      });
      saveTasks();
      render();
    }

    function handleFinish(uid){
      const task = tasks.find(t => t.TaskUID === uid);
      if (!task || task.State === "Finished") return;
      const nowIso = new Date().toISOString();
      if (task.State === "Running" && task.lastStart){
        task.TotalActiveMinutes += minutesBetween(task.lastStart, nowIso);
      }
      if (task.State === "Paused" && task.lastPause){
        task.TotalPausedMinutes += minutesBetween(task.lastPause, nowIso);
      }
      task.State = "Finished";
      task.ActualFinish = nowIso;
      task.lastStart = null;
      task.lastPause = null;
      task.Audit.push({ type:"finish", at: nowIso });
      saveTasks();
      render();
    }

    function parseProjectFile(text, name){
      const trimmed = (text || "").trim();
      if (!trimmed) throw new Error("File is empty");
      const lowerName = (name || "").toLowerCase();
      const looksXml = lowerName.endsWith(".xml") || trimmed.startsWith("<?xml") || trimmed.startsWith("<Project");
      if (looksXml){
        return parseMSPXml(trimmed);
      }
      return parseCSVToTasks(trimmed);
    }

    function parseMSPXml(xmlText){
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, "application/xml");
      const parseError = doc.querySelector("parsererror");
      if (parseError){
        throw new Error("Unable to parse XML file");
      }
      const tasks = [];
      const rows = Array.from(doc.getElementsByTagName("Task"));
      const byWBS = new Map();
      rows.forEach(node => {
        const uid = textContent(node, "UID");
        const name = textContent(node, "Name");
        const summary = textContent(node, "Summary");
        const wbs = textContent(node, "WBS");
        const outlineLevel = parseInt(textContent(node, "OutlineLevel"), 10) || 0;
        const start = textContent(node, "Start");
        const finish = textContent(node, "Finish");
        const pct = parseInt(textContent(node, "PercentComplete"), 10) || 0;
        const dept = textContent(node, "Text30");

        const record = {
          uid,
          name,
          summary: /^1|true$/i.test(summary || ""),
          wbs,
          outlineLevel,
          startRaw: start,
          finishRaw: finish,
          pct,
          dept,
          directParent: textContent(node, "SummaryName") || ""
        };
        if (wbs) byWBS.set(wbs, record);
        tasks.push(record);
      });
      const parentSet = computeParentSet(tasks);
      return tasks.filter(r => !r.summary && !parentSet.has(r.wbs)).map(r => toTaskObject(r, byWBS));
    }

    function parseCSVToTasks(text){
      const parsed = parseCSV(text);
      if (!parsed.headers.length) throw new Error("CSV headers missing");
      const columnMap = buildColumnMap(parsed.headers);
      const rawRows = parsed.rows.map(cells => {
        const summaryRaw = columnMap.summary !== -1 ? (cells[columnMap.summary] || "").trim() : "";
        return {
          uid: (cells[columnMap.uid] || "").trim(),
          name: (cells[columnMap.name] || "").trim(),
          summary: columnMap.summary === -1 ? false : /^(y|yes|true|1)$/i.test(summaryRaw),
          wbs: (columnMap.wbs !== -1 ? (cells[columnMap.wbs] || "").trim() : ""),
          outlineLevel: parseInt((columnMap.outlineLevel !== -1 ? cells[columnMap.outlineLevel] : ""), 10) || 0,
          startRaw: columnMap.start !== -1 ? (cells[columnMap.start] || "").trim() : "",
          finishRaw: columnMap.finish !== -1 ? (cells[columnMap.finish] || "").trim() : "",
          pct: parseInt((columnMap.pct !== -1 ? cells[columnMap.pct] : ""), 10) || 0,
          dept: columnMap.text30 !== -1 ? (cells[columnMap.text30] || "").trim() : "",
          directParent: columnMap.taskSummaryName !== -1 ? (cells[columnMap.taskSummaryName] || "").trim() : ""
        };
      }).filter(r => r.uid || r.name);

      const byWBS = new Map(rawRows.filter(r => r.wbs).map(r => [r.wbs, r]));
      const parentSet = computeParentSet(rawRows);
      return rawRows.filter(r => !r.summary && !parentSet.has(r.wbs)).map(r => toTaskObject(r, byWBS));
    }

    function toTaskObject(row, byWBS){
      const parentName = row.directParent || deriveParentName(row.wbs, byWBS);
      const start = parseDateField(row.startRaw);
      const finish = parseDateField(row.finishRaw);
      return {
        TaskUID: row.uid || makeUID(),
        TaskName: row.name || "Unnamed Task",
        SummaryTaskName: parentName,
        Department: row.dept || "",
        PlannedStart: start.iso,
        PlannedStartRaw: start.raw,
        PlannedFinish: finish.iso,
        PlannedFinishRaw: finish.raw,
        ActualStart: null,
        ActualFinish: null,
        State: "Idle",
        TotalActiveMinutes: 0,
        TotalPausedMinutes: 0,
        lastStart: null,
        lastPause: null,
        Audit: [],
        PercentComplete: row.pct || 0
      };
    }

    function computeParentSet(rows){
      const set = new Set();
      rows.forEach(r => {
        const wbs = r.wbs || "";
        if (!wbs.includes(".")) return;
        const parts = wbs.split(".");
        while (parts.length > 1){
          parts.pop();
          set.add(parts.join("."));
        }
      });
      return set;
    }

    function deriveParentName(wbs, byWBS){
      if (!wbs || !wbs.includes(".")) return "";
      const parts = wbs.split(".");
      parts.pop();
      while (parts.length){
        const key = parts.join(".");
        if (byWBS.has(key)){
          const candidate = byWBS.get(key);
          if (candidate && candidate.name) return candidate.name;
        }
        parts.pop();
      }
      return "";
    }

    function normalizeTask(task){
      const safe = task && typeof task === "object" ? { ...task } : {};
      const fixISO = value => {
        if (!value) return null;
        const date = new Date(value);
        return isNaN(date) ? null : date.toISOString();
      };
      return {
        TaskUID: String(safe.TaskUID || safe.uid || makeUID()),
        TaskName: String(safe.TaskName || safe.name || "Unnamed Task"),
        SummaryTaskName: String(safe.SummaryTaskName || safe.summaryTaskName || ""),
        Department: String(safe.Department || safe.department || ""),
        PlannedStart: fixISO(safe.PlannedStart || safe.PlannedStartRaw),
        PlannedStartRaw: String(safe.PlannedStartRaw || safe.PlannedStart || ""),
        PlannedFinish: fixISO(safe.PlannedFinish || safe.PlannedFinishRaw),
        PlannedFinishRaw: String(safe.PlannedFinishRaw || safe.PlannedFinish || ""),
        ActualStart: fixISO(safe.ActualStart || safe.actualStart),
        ActualFinish: fixISO(safe.ActualFinish || safe.actualFinish),
        State: safe.State === "Running" || safe.State === "Paused" || safe.State === "Finished" ? safe.State : "Idle",
        TotalActiveMinutes: Number.isFinite(safe.TotalActiveMinutes) ? safe.TotalActiveMinutes : 0,
        TotalPausedMinutes: Number.isFinite(safe.TotalPausedMinutes) ? safe.TotalPausedMinutes : 0,
        lastStart: fixISO(safe.lastStart),
        lastPause: fixISO(safe.lastPause),
        Audit: Array.isArray(safe.Audit) ? safe.Audit : [],
        PercentComplete: Number.isFinite(safe.PercentComplete) ? safe.PercentComplete : 0
      };
    }

    function parseCSV(text){
      const delimiter = detectDelimiter(text);
      const rows = [];
      let current = [];
      let field = "";
      let inQuotes = false;
      for (let i = 0; i < text.length; i++){
        const char = text[i];
        if (char === '"'){
          if (inQuotes && text[i+1] === '"'){
            field += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
          continue;
        }
        if (!inQuotes && char === delimiter){
          current.push(field);
          field = "";
          continue;
        }
        if (!inQuotes && (char === '\n' || char === '\r')){
          current.push(field);
          field = "";
          if (current.length){
            rows.push(current);
            current = [];
          }
          if (char === '\r' && text[i+1] === '\n'){
            i++;
          }
          continue;
        }
        field += char;
      }
      current.push(field);
      rows.push(current);

      const headers = rows.shift() || [];
      return {
        headers,
        rows: rows.filter(r => r.some(cell => cell && cell.trim()))
      };
    }

    function detectDelimiter(text){
      const sample = (text.match(/^[^\r\n]*/)||[""])[0];
      const candidates = [",",";",String.fromCharCode(9),"|"];
      let best = ',';
      let bestCount = -1;
      for (const candidate of candidates){
        let count = 0;
        let inQuotes = false;
        for (let i = 0; i < sample.length; i++){
          const char = sample[i];
          if (char === '"'){
            if (inQuotes && sample[i+1] === '"'){
              i++;
            } else {
              inQuotes = !inQuotes;
            }
            continue;
          }
          if (!inQuotes && char === candidate){
            count++;
          }
        }
        if (count > bestCount){
          best = candidate;
          bestCount = count;
        }
      }
      return best;
    }

    function buildColumnMap(headers){
      const normed = headers.map(normHeader);
      const findIndex = key => indexOfAlias(normed, key);
      const col = {
        uid: findIndex("unique id"),
        name: findIndex("name"),
        summary: findIndex("summary"),
        outlineLevel: findIndex("outline level"),
        wbs: findIndex("wbs"),
        start: findIndex("start"),
        finish: findIndex("finish"),
        pct: findIndex("% complete"),
        res: findIndex("resource names"),
        text30: findIndex("text30"),
        taskSummaryName: findIndex("task summary name")
      };
      const must = ["uid","name","outlineLevel","wbs","start","finish","pct"];
      const missing = must.filter(key => col[key] === -1);
      if (missing.length){
        throw new Error(`Missing required columns: ${missing.join(", ")}`);
      }
      return col;
    }

    function indexOfAlias(headers, key){
      const aliases = HEADER_ALIASES[key] || [key];
      for (let i = 0; i < headers.length; i++){
        if (aliases.some(alias => headers[i] === normHeader(alias))){
          return i;
        }
      }
      return -1;
    }

    function normHeader(header){
      let value = header || "";
      value = value.replace(/^[\uFEFF\u200B]+/, "");
      if (typeof value.normalize === "function"){
        value = value.normalize("NFKD");
      }
      // strip combining marks that remain after normalization
      value = value.replace(/[\u0300-\u036f]/g, "");
      value = value.replace(/[_-]+/g, " ");
      // keep only ASCII letters/numbers plus % . and spaces for broad browser support
      value = value.replace(/[^A-Za-z0-9%\. ]+/g, " ");
      return value
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
    }

    function parseDateField(value){
      const raw = (value || "").trim();
      if (!raw) return { iso: null, raw: "" };
      let date = new Date(raw);
      if (isNaN(date)){ // try dd/MM/yyyy HH:mm or similar
        const parts = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
        if (parts){
          const m = parseInt(parts[1], 10);
          const d = parseInt(parts[2], 10);
          const y = parseInt(parts[3], 10);
          const hh = parseInt(parts[4] || "0", 10);
          const mm = parseInt(parts[5] || "0", 10);
          const ss = parseInt(parts[6] || "0", 10);
          date = new Date(y < 100 ? 2000 + y : y, m - 1, d, hh, mm, ss);
        }
      }
      if (isNaN(date)) return { iso: null, raw };
      return { iso: date.toISOString(), raw };
    }

    function parseDateSimple(value){
      if (!value) return null;
      const date = new Date(value);
      return isNaN(date) ? null : date;
    }

    function displayDate(iso, fallback){
      if (iso){
        const date = parseDateSimple(iso);
        if (date) return date.toLocaleString();
      }
      if (fallback){
        const date = parseDateSimple(fallback);
        if (date) return date.toLocaleString();
        return escapeHTML(fallback);
      }
      return "";
    }

    function sortByPlannedStart(a, b){
      const aMs = a.PlannedStart ? Date.parse(a.PlannedStart) : NaN;
      const bMs = b.PlannedStart ? Date.parse(b.PlannedStart) : NaN;
      if (isNaN(aMs) && isNaN(bMs)) return a.TaskName.localeCompare(b.TaskName);
      if (isNaN(aMs)) return 1;
      if (isNaN(bMs)) return -1;
      if (aMs === bMs) return a.TaskName.localeCompare(b.TaskName);
      return aMs - bMs;
    }

    function minutesBetween(startIso, endIso){
      if (!startIso || !endIso) return 0;
      const start = Date.parse(startIso);
      const end = Date.parse(endIso);
      if (isNaN(start) || isNaN(end)) return 0;
      return Math.max(0, Math.round((end - start) / 60000));
    }

    function readStorage(key){
      try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
      } catch {
        return null;
      }
    }

    function sanitizeDelayEntries(entries){
      if (!Array.isArray(entries)) return [];
      return entries
        .map(entry => ({
          LoggedAt: toISO(entry.LoggedAt || entry.loggedAt),
          TaskUID: entry.TaskUID || entry.uid || "",
          TaskName: entry.TaskName || entry.taskName || "",
          SummaryTaskName: entry.SummaryTaskName || entry.summaryTaskName || "",
          Department: entry.Department || entry.department || "",
          PlannedStart: toISO(entry.PlannedStart || entry.plannedStart),
          ActualStart: toISO(entry.ActualStart || entry.actualStart),
          Reason: entry.Reason || entry.reason || "",
          Notes: entry.Notes || entry.notes || ""
        }))
        .filter(entry => entry.TaskUID || entry.TaskName || entry.Reason || entry.Notes);
    }

    function toISO(value){
      if (!value) return null;
      const date = new Date(value);
      return isNaN(date) ? null : date.toISOString();
    }

    function escapeHTML(str){
      return (str || "").replace(/[&<>"']/g, ch => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      })[ch]);
    }

    function formatDateForFile(date){
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      const hh = String(date.getHours()).padStart(2, "0");
      const mm = String(date.getMinutes()).padStart(2, "0");
      return `${y}${m}${d}_${hh}${mm}`;
    }

    function buildExportCSV(list){
      const header = [
        "TaskUID","TaskName","SummaryTaskName","Department",
        "PlannedStart","PlannedFinish","ActualStart","ActualFinish",
        "State","TotalActiveMinutes","TotalPausedMinutes"
      ];
      const lines = [header.join(",")];
      list.forEach(task => {
        const row = [
          quote(task.TaskUID),
          quote(task.TaskName),
          quote(task.SummaryTaskName),
          quote(task.Department),
          quote(task.PlannedStart || task.PlannedStartRaw || ""),
          quote(task.PlannedFinish || task.PlannedFinishRaw || ""),
          quote(task.ActualStart || ""),
          quote(task.ActualFinish || ""),
          quote(task.State),
          task.TotalActiveMinutes,
          task.TotalPausedMinutes
        ];
        lines.push(row.join(","));
      });
      return lines.join("\n");
    }

    function quote(value){
      const str = value == null ? "" : String(value);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g,'""')}"` : str;
    }

    async function readFileSmart(file){
      if (!file) return "";
      if (file.arrayBuffer){
        const buffer = await file.arrayBuffer();
        const view = new Uint8Array(buffer);
        if (view.length >= 2){
          if (typeof TextDecoder === "function"){
            if (view[0] === 0xFF && view[1] === 0xFE){
              return new TextDecoder("utf-16le").decode(buffer.slice(2));
            }
            if (view[0] === 0xFE && view[1] === 0xFF){
              return new TextDecoder("utf-16be").decode(buffer.slice(2));
            }
          }
        }
        if (typeof TextDecoder === "function" && view.length >= 3 && view[0] === 0xEF && view[1] === 0xBB && view[2] === 0xBF){
          return new TextDecoder("utf-8").decode(buffer.slice(3));
        }
        if (typeof TextDecoder === "function"){
          try {
            return new TextDecoder("utf-8").decode(buffer);
          } catch {
            // continue to fallback below
          }
        }
        return await file.text();
      }
      if (file.text) return await file.text();
      return "";
    }

    function textContent(node, tag){
      const el = node.getElementsByTagName(tag)[0];
      return el && el.textContent ? el.textContent.trim() : "";
    }

    // expose for manual testing
    window.__LiveProjectTracker = {
      loadTasks: () => tasks,
      clear: () => { tasks = []; saveTasks(); render(); }
    };
  });
})();
