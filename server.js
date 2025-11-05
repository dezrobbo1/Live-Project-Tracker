import express from 'express';
import cors from 'cors';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({limit:'2mb'}));
app.use(express.static('public'));

// --- naive persistence (file-based for local dev; Render is ephemeral) ---
const DB_FILE = process.env.DB_FILE || './data.json';
let db = { tasks: [], delayLog: [] };

function loadDB(){
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    db = JSON.parse(raw);
    if(!db.tasks) db.tasks = [];
    if(!db.delayLog) db.delayLog = [];
  } catch (e) {
    db = { tasks: [], delayLog: [] };
  }
}
function saveDB(){
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');
  } catch (e) {
    console.error('[saveDB] failed', e);
  }
}

loadDB();

// --- API ---
app.get('/api/health', (req,res)=> res.json({ ok:true, ts: Date.now() }));

app.get('/api/export', (req,res)=>{
  res.json({ tasks: db.tasks, delayLog: db.delayLog });
});

app.post('/api/tasks', (req,res)=>{
  const { tasks } = req.body || {};
  if(!Array.isArray(tasks)) return res.status(400).json({ error: 'tasks must be an array' });
  db.tasks = tasks;
  saveDB();
  res.json({ ok:true, count: db.tasks.length });
});

app.post('/api/delay-log', (req,res)=>{
  const { message } = req.body || {};
  const entry = {
    message: String(message || 'Delay recorded'),
    at: new Date().toISOString()
  };
  db.delayLog.push(entry);
  saveDB();
  res.json({ ok:true, entry });
});

app.post('/api/clear', (req,res)=>{
  db.tasks = [];
  saveDB();
  res.json({ ok:true });
});

app.listen(PORT, ()=>{
  console.log(`[server] http://localhost:${PORT}`);
});
