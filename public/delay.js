// Delay Log page — reads/writes localStorage and supports CSV export/clear
window.addEventListener("DOMContentLoaded", () => {
  console.log("%c[DelayLog] loaded", "color:#ffcc66");

  const tbody = document.querySelector("#delayTable tbody");
  const exportBtn = document.getElementById("exportDelayBtn");
  const clearBtn  = document.getElementById("clearDelayBtn");
  const DELAY_LOG_KEY = "DELAY_LOG_V1";

  function readDelayLog(){
    try { return JSON.parse(localStorage.getItem(DELAY_LOG_KEY) || "[]"); }
    catch { return []; }
  }
  function writeDelayLog(arr){
    localStorage.setItem(DELAY_LOG_KEY, JSON.stringify(arr));
  }

  function fmt(ts){
    if (!ts) return "";
    const d = new Date(ts);
    return isNaN(d) ? ts : d.toLocaleString();
  }

  function render(){
    const rows = readDelayLog();
    tbody.innerHTML = "";
    rows.forEach(r=>{
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${fmt(r.LoggedAt)}</td>
        <td>${r.TaskName || ""}</td>
        <td>${r.SummaryTaskName || ""}</td>
        <td>${r.Department || ""}</td>
        <td>${fmt(r.PlannedStart)}</td>
        <td>${fmt(r.ActualStart)}</td>
        <td>${r.Reason || ""}</td>
        <td>${(r.Notes || "").replace(/</g,"&lt;")}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function exportCSV(){
    const rows = readDelayLog();
    const csvRows = [
      "LoggedAt,TaskUID,TaskName,TaskSummaryName,Department,PlannedStart,ActualStart,Reason,Notes",
      ...rows.map(r => [
        r.LoggedAt || "",
        r.TaskUID || "",
        quote(r.TaskName),
        quote(r.SummaryTaskName),
        quote(r.Department),
        r.PlannedStart || "",
        r.ActualStart || "",
        quote(r.Reason),
        quote(r.Notes)
      ].join(","))
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "delay_log.csv";
    a.click();

    function quote(s){
      const t = (s ?? "").toString();
      return /[",\n]/.test(t) ? `"${t.replace(/"/g,'""')}"` : t;
    }
  }

  function clearLog(){
    if (!confirm("Clear the entire Delay Log?")) return;
    writeDelayLog([]);
    render();
  }

  exportBtn.addEventListener("click", exportCSV);
  clearBtn.addEventListener("click", clearLog);

  render();
});
