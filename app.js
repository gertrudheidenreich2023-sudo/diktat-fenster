// Diktat-Fenster v0.4
// Ablauf: Fenster öffnet sich (Alt+1) → Aufnahme startet automatisch →
// Leertaste: nur Zwischenablage · Enter: Zwischenablage + Notiz als Datei im gewählten Ordner →
// Fenster schließt → Strg+V in der App. Taste N: Notizen ansehen.

const $ = (id) => document.getElementById(id);
const MAX_MS = 5 * 60 * 1000;
const HALLUCINATIONS = [
  /untertitel/i, /amara\.org/i, /vielen dank f(ü|ue|u)rs zuschauen/i,
  /bis zum n(ä|ae)chsten mal/i, /copyright/i, /swr\s*20\d\d/i
];

const settings = {
  get apiKey() { return localStorage.getItem('apiKey') || ''; },
  get model() { return localStorage.getItem('model') || 'whisper-large-v3'; },
  get vocab() { return localStorage.getItem('vocab') || ''; },
  get autoClose() { return localStorage.getItem('autoClose') !== 'false'; },
  get cleanup() { return localStorage.getItem('cleanup') !== 'false'; },
  get lang() { return localStorage.getItem('lang') || ''; },
  get llmModel() { return localStorage.getItem('llmModel') || 'openai/gpt-oss-120b'; }
};

let state = 'idle';
let recorder = null, stream = null, chunks = [], startedAt = 0, maxTimer = null, cancelled = false;
let audioCtx = null;
let saveMode = false, folderPromise = null, closeAfterCancel = true, focusQuietUntil = 0;

// ---------- Anzeige ----------

function setState(s, msg, sub) {
  state = s;
  document.body.dataset.state = s;
  $('msg').textContent = msg;
  if (sub !== undefined) $('sub').textContent = sub;
}

// ---------- Aufnahme ----------

async function start() {
  if (state === 'starting' || state === 'recording' || state === 'processing') return;
  if (!settings.apiKey) {
    setState('idle', 'Bitte zuerst den Groq-Schlüssel eintragen', '');
    $('setup').open = true;
    $('apiKey').focus();
    return;
  }
  $('result').textContent = '';
  cancelled = false;
  saveMode = false;
  folderPromise = null;
  state = 'starting'; // verhindert Doppelstart durch Laden + Fokus-Ereignis
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
    });
  } catch (e) {
    setState('error', 'Mikrofon nicht verfügbar', 'Unter „Einstellungen" auf „Mikrofon freigeben" klicken.');
    $('setup').open = true;
    return;
  }
  if (cancelled) { // während des Starts wurde ein Bereich aufgeklappt
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
    setState('idle', 'Bereit', 'Enter: neue Aufnahme');
    return;
  }
  chunks = [];
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 });
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = onStopped;
  recorder.start(1000);
  startedAt = performance.now();
  maxTimer = setTimeout(stop, MAX_MS);
  beep('start');
  setState('recording', 'Ich höre zu …', 'Leertaste: kopieren · Enter: kopieren und speichern · Esc: abbrechen');
}

function stop() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}

function cancel(close = true) {
  cancelled = true;
  closeAfterCancel = close;
  stop();
}

async function onStopped() {
  clearTimeout(maxTimer);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  const audioMs = performance.now() - startedAt;
  const blob = new Blob(chunks, { type: recorder.mimeType });
  recorder = null;
  chunks = [];

  if (cancelled) {
    setState('idle', 'Abgebrochen', closeAfterCancel ? '' : 'Enter: neue Aufnahme');
    if (closeAfterCancel) closeSoon();
    return;
  }
  beep('stop');
  if (audioMs < 700 || blob.size < 2000) {
    setState('idle', 'Nichts aufgenommen', 'Enter: neue Aufnahme');
    return;
  }

  setState('processing', 'Wird erkannt …', '');
  const t0 = performance.now();
  let raw;
  try {
    raw = await transcribe(blob);
  } catch (e) {
    beep('error');
    setState('error', 'Fehler bei Groq', e.message);
    return;
  }
  const sttMs = performance.now() - t0;

  if (!raw || (raw.length < 120 && HALLUCINATIONS.some((r) => r.test(raw)))) {
    setState('idle', 'Kein Text erkannt', 'Enter: neue Aufnahme');
    return;
  }

  let result = { text: raw, cleaned: false, note: 'Bereinigung aus', ms: 0 };
  if (settings.cleanup) {
    setState('processing', 'Wird bereinigt …', '');
    result = await cleanupText(raw, { apiKey: settings.apiKey, model: settings.llmModel, mode: 'standard', vocab: settings.vocab });
  }
  const text = result.text;
  const latencyMs = sttMs + result.ms;

  $('result').textContent = text;

  // Bei Enter: erst den Ordner sicherstellen (beim ersten Mal öffnet sich die Ordnerauswahl),
  // damit das Fenster beim Kopieren wieder den Fokus hat.
  let folder = null, folderError = '';
  if (saveMode) {
    try { folder = await folderPromise; } catch (e) { folderError = e.message; }
    if (!folder && !folderError) folderError = 'Kein Ordner freigegeben';
  }

  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch {}

  let savedAs = '', saveError = folderError;
  if (folder) {
    try { savedAs = await saveNote(folder, text); } catch (e) { saveError = e.message || e.name; }
  }

  addHistory({ t: Date.now(), raw, text, cleaned: result.cleaned, note: result.note,
    audioMs: Math.round(audioMs), sttMs: Math.round(sttMs), llmMs: result.ms, file: savedAs });
  if (savedAs && $('notes').open) loadNotes();

  const secs = `${(latencyMs / 1000).toFixed(1).replace('.', ',')} s`;
  const hint = result.note && settings.cleanup ? ` · ${result.note}` : '';

  if (saveMode && !savedAs) {
    beep('error');
    setState('error', copied ? 'Nicht gespeichert – nur in der Zwischenablage' : 'Nicht gespeichert und nicht kopiert',
      `${saveError}. Text unten markieren und kopieren, dann unter „Notizen" den Ordner freigeben.`);
    return;
  }
  if (!copied) {
    setState('error', savedAs ? 'Gespeichert, aber nicht kopiert' : 'Kopieren nicht möglich',
      'Text unten markieren und mit Strg+C kopieren.');
    return;
  }
  if (savedAs) {
    beep('saved');
    setState('done', 'Gespeichert und in der Zwischenablage', `${secs} · ${savedAs}${hint}`);
  } else {
    setState('done', 'In der Zwischenablage', `${secs} · Strg+V in der App${hint}`);
  }
  if (settings.autoClose) closeSoon();
}

// Fenster schließen; falls ChromeOS das nicht zulässt, bleibt es einfach offen.
function closeSoon() {
  setTimeout(() => {
    window.close();
    setTimeout(() => { if (state !== 'recording') $('sub').textContent += ' · Fenster ließ sich nicht schließen – Alt+Tab'; }, 300);
  }, 350);
}

// ---------- Groq Whisper ----------

async function transcribe(blob) {
  const fd = new FormData();
  fd.append('file', blob, 'diktat.webm');
  fd.append('model', settings.model);
  if (settings.lang) fd.append('language', settings.lang); // leer = automatische Erkennung
  fd.append('response_format', 'json');
  fd.append('temperature', '0');
  if (settings.vocab) fd.append('prompt', settings.vocab.slice(0, 800));

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 30000);
  let res;
  try {
    res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + settings.apiKey }, body: fd, signal: ctrl.signal
    });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Zeitüberschreitung (30 s)' : 'Keine Verbindung');
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch {}
    throw new Error(`Fehler ${res.status} ${detail}`.trim());
  }
  return ((await res.json()).text || '').trim();
}

// ---------- Töne (können ohne vorherigen Klick stumm bleiben) ----------

function tone(freq, dur, delay = 0) {
  try {
    audioCtx ||= new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime + delay;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  } catch {}
}
function beep(kind) {
  if (kind === 'start') { tone(880, 0.07); tone(1320, 0.07, 0.08); }
  else if (kind === 'saved') { tone(880, 0.06); tone(1175, 0.06, 0.07); tone(1568, 0.1, 0.14); }
  else if (kind === 'stop') { tone(1320, 0.07); tone(880, 0.07, 0.08); }
  else { tone(330, 0.15); tone(330, 0.15, 0.2); }
}

// ---------- Tastatur & Fokus ----------

document.addEventListener('keydown', (e) => {
  const inForm = e.target.closest?.('details');
  if (inForm) return; // in Notizen und Einstellungen normal bedienen
  if (e.key === 'Escape') {
    e.preventDefault();
    if (state === 'recording') cancel(); else window.close();
  } else if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (state !== 'recording') { start(); return; }
    saveMode = e.key === 'Enter';
    stop();
    // Die Freigabe braucht einen Tastendruck – deshalb sofort hier anstoßen, nicht erst nach der Erkennung.
    if (saveMode) folderPromise = getFolder(true);
  } else if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.altKey && !e.metaKey) {
    e.preventDefault();
    $('notes').open = true;
    $('notes').scrollIntoView({ block: 'start' });
    $('notes').querySelector('summary').focus();
  }
});

$('dot').onclick = () => (state === 'recording' ? stop() : start());

// Wird das offene Fenster per Alt+1 wieder nach vorn geholt, startet die nächste Aufnahme.
window.addEventListener('focus', () => {
  if (Date.now() < focusQuietUntil) return; // Rückkehr aus der Ordnerauswahl
  if ($('setup').open || $('notes').open) return;
  if (state === 'idle' || state === 'done' || state === 'error') start();
});

// Aufklappen von Notizen oder Einstellungen beendet eine laufende Aufnahme, ohne das Fenster zu schließen.
for (const id of ['notes', 'setup']) {
  $(id).addEventListener('toggle', () => {
    if (!$(id).open) return;
    if (state === 'recording' || state === 'starting') cancel(false);
    if (id === 'notes') loadNotes();
  });
}

// ---------- Notizen-Ordner (File System Access API) ----------

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('diktat', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kv(key, value) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', value === undefined ? 'readonly' : 'readwrite');
    const r = value === undefined ? tx.objectStore('kv').get(key) : tx.objectStore('kv').put(value, key);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

// interactive = true nur direkt nach einem Tastendruck oder Klick (Chrome verlangt das).
async function getFolder(interactive, choose = false) {
  const opts = { mode: 'readwrite' };
  let dir = choose ? null : await kv('folder');
  if (dir) {
    if (await dir.queryPermission(opts) === 'granted') return dir;
    if (!interactive) return null;
    if (await dir.requestPermission(opts) === 'granted') return dir;
    throw new Error('Ordnerzugriff nicht erlaubt');
  }
  if (!interactive) return null;
  try {
    dir = await window.showDirectoryPicker({ id: 'diktate', mode: 'readwrite', startIn: 'documents' });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? 'Kein Ordner gewählt' : 'Ordnerauswahl nicht möglich');
  } finally {
    focusQuietUntil = Date.now() + 1500;
  }
  await kv('folder', dir);
  return dir;
}

function fileStamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

async function exists(dir, name) {
  try { await dir.getFileHandle(name); return true; } catch { return false; }
}

async function saveNote(dir, text) {
  const stamp = fileStamp(new Date());
  let name = stamp + '.txt';
  for (let i = 2; await exists(dir, name); i++) name = `${stamp}-${i}.txt`;
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(text.endsWith('\n') ? text : text + '\n');
  await w.close();
  return name;
}

// ---------- Notizen-Übersicht ----------

function btn(label, onClick, quiet = true) {
  const b = document.createElement('button');
  b.className = quiet ? 'btn quiet small' : 'btn small';
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

async function loadNotes() {
  const status = $('notesStatus');
  const list = $('notesList');
  const actions = $('notesActions');
  list.replaceChildren();
  actions.replaceChildren();

  let dir = null;
  const stored = await kv('folder').catch(() => null);
  try { dir = await getFolder(false); } catch {}

  if (!stored) {
    status.textContent = 'Noch kein Ordner gewählt. Lege zum Beispiel unter „Meine Dateien" einen Ordner „Diktate" an.';
    actions.append(btn('Ordner wählen', () => chooseFolder(true), false));
    return;
  }
  if (!dir) {
    status.textContent = `Ordner „${stored.name}" braucht eine neue Freigabe.`;
    actions.append(btn('Ordner freigeben', () => chooseFolder(false), false), btn('Anderen Ordner wählen', () => chooseFolder(true)));
    return;
  }

  const notes = [];
  for await (const [name, h] of dir.entries()) {
    if (h.kind !== 'file' || !/\.(txt|md)$/i.test(name)) continue;
    const f = await h.getFile();
    notes.push({ name, modified: f.lastModified, text: await f.text() });
  }
  notes.sort((a, b) => b.modified - a.modified || b.name.localeCompare(a.name));

  status.textContent = `${notes.length} ${notes.length === 1 ? 'Notiz' : 'Notizen'} in „${dir.name}"`;
  actions.append(btn('Aktualisieren', loadNotes), btn('Anderen Ordner wählen', () => chooseFolder(true)));
  if (!notes.length) {
    const li = document.createElement('li');
    li.textContent = 'Noch keine Notizen. Diktat mit Enter beenden, um eine Notiz zu speichern.';
    list.append(li);
    return;
  }

  for (const n of notes) {
    const li = document.createElement('li');
    const meta = document.createElement('small');
    meta.textContent = new Date(n.modified).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
    const body = document.createElement('div');
    body.className = 'note-text';
    body.textContent = n.text.trim();
    body.title = 'Klicken zum Auf- und Zuklappen';
    body.onclick = () => body.classList.toggle('open');
    const row = document.createElement('div');
    row.className = 'row';
    const copy = btn('Kopieren', async () => {
      try { await navigator.clipboard.writeText(n.text.trim()); copy.textContent = 'Kopiert'; }
      catch { copy.textContent = 'Nicht möglich'; }
      setTimeout(() => (copy.textContent = 'Kopieren'), 1500);
    }, false);
    const del = btn('Löschen', async () => {
      if (!confirm(`Notiz vom ${meta.textContent} löschen?`)) return;
      try { await dir.removeEntry(n.name); li.remove(); loadNotes(); }
      catch (e) { alert('Löschen nicht möglich: ' + (e.message || e.name)); }
    });
    row.append(copy, del);
    li.append(meta, body, row);
    list.append(li);
  }
}

async function chooseFolder(choose) {
  try { await getFolder(true, choose); }
  catch (e) { $('notesStatus').textContent = e.message; return; }
  loadNotes();
}

// ---------- Einstellungen & Verlauf ----------

function loadSetup() {
  $('apiKey').value = settings.apiKey;
  $('model').value = settings.model;
  $('vocab').value = settings.vocab;
  $('autoClose').checked = settings.autoClose;
  $('cleanup').checked = settings.cleanup;
  $('llmModel').value = settings.llmModel;
  $('lang').value = settings.lang;
}

$('save').onclick = () => {
  localStorage.setItem('apiKey', $('apiKey').value.trim());
  localStorage.setItem('model', $('model').value);
  localStorage.setItem('vocab', $('vocab').value.trim());
  localStorage.setItem('autoClose', String($('autoClose').checked));
  localStorage.setItem('cleanup', String($('cleanup').checked));
  localStorage.setItem('llmModel', $('llmModel').value);
  localStorage.setItem('lang', $('lang').value);
  $('setupStatus').textContent = 'Gespeichert';
};

$('mic').onclick = async () => {
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    $('setupStatus').textContent = 'Mikrofon freigegeben';
  } catch (e) {
    $('setupStatus').textContent = 'Nicht freigegeben: ' + e.name;
  }
};

function addHistory(entry) {
  const h = JSON.parse(localStorage.getItem('history') || '[]');
  h.unshift(entry);
  localStorage.setItem('history', JSON.stringify(h.slice(0, 20)));
  renderHistory();
}

function renderHistory() {
  const ol = $('history');
  ol.replaceChildren();
  for (const x of JSON.parse(localStorage.getItem('history') || '[]')) {
    const li = document.createElement('li');
    const meta = document.createElement('small');
    const sec = (ms) => ((ms || 0) / 1000).toFixed(1).replace('.', ',') + ' s';
    const parts = [`Aufnahme ${sec(x.audioMs)}`, `Erkennung ${sec(x.sttMs ?? x.latencyMs)}`];
    if (x.cleaned) parts.push(`Bereinigung ${sec(x.llmMs)}`);
    meta.textContent = new Date(x.t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) + ' – ' + parts.join(', ');
    li.append(meta, document.createTextNode(x.text));
    if ((x.raw && x.raw !== x.text) || x.note) {
      const d = document.createElement('details');
      const sm = document.createElement('summary');
      sm.textContent = x.note ? `Rohtext (${x.note})` : 'Rohtext';
      const r = document.createElement('div');
      r.textContent = x.raw || '';
      d.append(sm, r);
      d.onclick = (ev) => ev.stopPropagation();
      li.append(d);
    }
    li.title = 'Klicken zum Kopieren';
    li.style.cursor = 'pointer';
    li.onclick = () => navigator.clipboard.writeText(x.text);
    ol.append(li);
  }
}

loadSetup();
renderHistory();
start(); // beim Öffnen sofort loslegen
