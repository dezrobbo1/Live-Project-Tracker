(function(){
  const DELAY_KEY = "LPT_DELAY_LOG_V1";
  const LEGACY_KEYS = ["DELAY_LOG_V1"];

  window.addEventListener("DOMContentLoaded", () => {
    const tableBody = document.querySelector("#delayTable tbody");
    const notice = document.getElementById("delayNotice");
    const backBtn = document.getElementById("backBtn");
    const exportBtn = document.getElementById("exportDelayBtn");
    const clearBtn = document.getElementById("clearDelayBtn");

    if (!tableBody || !backBtn || !exportBtn || !clearBtn) return;

    let entries = loadEntries();
    saveEntries(entries);
    render();

    backBtn.addEventListener("click", () => { window.location.href = "/"; });
    exportBtn.addEventListener("click", exportCSV);
    clearBtn.addEventListener("click", clearLog);

    function loadEntries(){
      const current = readStorage(DELAY_KEY);
      if (Array.isArray(current) && current.length) return sanitize(current);
      for (const key of LEGACY_KEYS){
        const legacy = readStorage(key);
        if (Array.isArray(legacy) && legacy.length) return sanitize(legacy);
      }
      return [];
    }

    function saveEntries(list){
      try {
        localStorage.setItem(DELAY_KEY, JSON.stringify(sanitize(list)));
      } catch (err) {
        console.warn("[DelayLog] unable to save", err);
      }
    }

    function render(){
      tableBody.innerHTML = "";
      if (!entries.length){
        if (notice) notice.textContent = "No pauses have been recorded.";
        return;
      }
      if (notice) notice.textContent = `Showing ${entries.length} recorded pauses.`;
      const sorted = [...entries].sort((a,b) => {
        const aTime = a.LoggedAt ? Date.parse(a.LoggedAt) : 0;
        const bTime = b.LoggedAt ? Date.parse(b.LoggedAt) : 0;
        return bTime - aTime;
      });
      sorted.forEach(entry => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${formatDate(entry.LoggedAt)}</td>
          <td>${escapeHTML(entry.TaskName)}</td>
          <td>${escapeHTML(entry.SummaryTaskName)}</td>
          <td>${escapeHTML(entry.Department)}</td>
          <td>${formatDate(entry.PlannedStart)}</td>
          <td>${formatDate(entry.ActualStart)}</td>
          <td>${escapeHTML(entry.Reason)}</td>
          <td>${escapeHTML(entry.Notes)}</td>
        `;
        tableBody.appendChild(tr);
      });
    }

    function exportCSV(){
      if (!entries.length){
        alert("No delay log entries to export.");
        return;
      }
      const header = ["LoggedAt","TaskUID","TaskName","SummaryTaskName","Department","PlannedStart","ActualStart","Reason","Notes"];
      const lines = [header.join(",")];
      entries.forEach(entry => {
        const row = [
          entry.LoggedAt || "",
          entry.TaskUID || "",
          quote(entry.TaskName),
          quote(entry.SummaryTaskName),
          quote(entry.Department),
          entry.PlannedStart || "",
          entry.ActualStart || "",
          quote(entry.Reason),
          quote(entry.Notes)
        ];
        lines.push(row.join(","));
      });
      const blob = new Blob([lines.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `delay_log_${timestampSuffix()}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }

    function clearLog(){
      if (!entries.length) return;
      if (!confirm("Clear the entire delay log?")) return;
      entries = [];
      saveEntries(entries);
      render();
    }

    function sanitize(list){
      if (!Array.isArray(list)) return [];
      return list
        .map(item => ({
          LoggedAt: toISO(item.LoggedAt || item.loggedAt),
          TaskUID: item.TaskUID || item.uid || "",
          TaskName: item.TaskName || item.taskName || "",
          SummaryTaskName: item.SummaryTaskName || item.summaryTaskName || "",
          Department: item.Department || item.department || "",
          PlannedStart: toISO(item.PlannedStart || item.plannedStart),
          ActualStart: toISO(item.ActualStart || item.actualStart),
          Reason: item.Reason || item.reason || "",
          Notes: item.Notes || item.notes || ""
        }))
        .filter(item => item.TaskUID || item.TaskName || item.Reason || item.Notes);
    }

    function toISO(value){
      if (!value) return null;
      const date = new Date(value);
      return isNaN(date) ? null : date.toISOString();
    }

    function formatDate(value){
      if (!value) return "";
      const date = new Date(value);
      if (isNaN(date)) return escapeHTML(value);
      return date.toLocaleString();
    }

    function quote(value){
      const str = value == null ? "" : String(value);
      return /[",\n]/.test(str) ? `"${str.replace(/"/g,'""')}"` : str;
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

    function timestampSuffix(){
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      const hh = String(now.getHours()).padStart(2, "0");
      const mm = String(now.getMinutes()).padStart(2, "0");
      return `${y}${m}${d}_${hh}${mm}`;
    }

    function readStorage(key){
      try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
      } catch {
        return null;
      }
    }
  });
})();
