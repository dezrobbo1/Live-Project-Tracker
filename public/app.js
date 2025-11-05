window.addEventListener("DOMContentLoaded", () => {
  console.log("[Tracker] JS loaded");

  const importBtn = document.getElementById("importBtn");
  const fileInput = document.getElementById("fileInput");
  const tableBody = document.querySelector("#taskTable tbody");
  const pauseDialog = document.getElementById("pauseDialog");
  const pauseReason = document.getElementById("pauseReason");
  const pauseNotes = document.getElementById("pauseNotes");
  const confirmPause = document.getElementById("confirmPause");
  const pauseTaskName = document.getElementById("pauseTaskName");

  let tasks = [];
  let pauseUID = null;

  importBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", handleImport);

  function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const lines = reader.result.split(/\r?\n/).filter(Boolean);
      const headers = lines[0].split(",");
      const rows = lines.slice(1).map(r => r.split(","));
      tasks = rows.map(r => ({
        id: r[0],
        summary: r[1],
        name: r[2],
        dept: r[3],
        start: r[4],
        actualStart: "",
        delay: 0,
        state: "Idle"
      }));
      render();
    };
    reader.readAsText(file);
  }

  function render() {
    tableBody.innerHTML = "";
    tasks.forEach(t => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${t.summary}</td>
        <td>${t.name}</td>
        <td>${t.dept || ""}</td>
        <td>${t.start}</td>
        <td>${t.actualStart}</td>
        <td>${t.delay}</td>
        <td>
          <button ${t.state === "Active" ? "disabled" : ""} onclick="startTask('${t.id}')">Start</button>
          <button ${t.state === "Active" ? "" : "disabled"} onclick="pauseTask('${t.id}')">Pause</button>
          <button ${t.state !== "Idle" ? "" : "disabled"} onclick="finishTask('${t.id}')">Finish</button>
        </td>`;
      tableBody.appendChild(row);
    });
  }

  window.startTask = id => {
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    t.actualStart = new Date().toLocaleTimeString();
    t.state = "Active";
    render();
  };

  window.pauseTask = id => {
    pauseUID = id;
    const t = tasks.find(x => x.id === id);
    pauseTaskName.textContent = t.name;
    pauseDialog.showModal();
  };

  confirmPause.addEventListener("click", e => {
    e.preventDefault();
    const t = tasks.find(x => x.id === pauseUID);
    if (t) {
      t.state = "Paused";
      t.delay += 15; // demo increment
      t.reason = pauseReason.value;
      t.notes = pauseNotes.value;
      pauseDialog.close();
      render();
    }
  });

  window.finishTask = id => {
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    t.state = "Finished";
    render();
  };
});
