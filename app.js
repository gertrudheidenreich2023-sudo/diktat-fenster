// Diktat-Fenster v0.3
// Ablauf: Fenster öffnet sich (Alt+1) → Aufnahme startet automatisch →
// Leertaste/Enter → Groq Whisper → Zwischenablage → Fenster schließt → Strg+V in der App.

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
  chunks = [];
  const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
  recorder = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32000 });
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = onStopped;
  recorder.start(1000);
  startedAt = performance.now();
  maxTimer = setTimeout(stop, MAX_MS);
  beep('start');
  setState('recording', 'Ich höre zu …', 'Leertaste oder Enter: fertig · Esc: abbrechen');
}

function stop() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
}

function cancel() {
  cancelled = true;
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
    setState('idle', 'Abgebrochen', '');
    closeSoon();
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
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch {}
  addHistory({ t: Date.now(), raw, text, cleaned: result.cleaned, note: result.note,
    audioMs: Math.round(audioMs), sttMs: Math.round(sttMs), llmMs: result.ms });

  if (copied) {
    const hint = result.note && settings.cleanup ? ` · ${result.note}` : '';
    setState('done', 'In der Zwischenablage', `${(latencyMs / 1000).toFixed(1).replace('.', ',')} s · Strg+V in der App${hint}`);
    if (settings.autoClose) closeSoon();
  } else {
    setState('error', 'Kopieren nicht möglich', 'Text unten markieren und mit Strg+C kopieren.');
  }
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
  else if (kind === 'stop') { tone(1320, 0.07); tone(880, 0.07, 0.08); }
  else { tone(330, 0.15); tone(330, 0.15, 0.2); }
}

// ---------- Tastatur & Fokus ----------

document.addEventListener('keydown', (e) => {
  const inForm = e.target.closest?.('details');
  if (inForm) return; // in den Einstellungen normal tippen
  if (e.key === 'Escape') {
    e.preventDefault();
    if (state === 'recording') cancel(); else window.close();
  } else if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault();
    if (state === 'recording') stop(); else start();
  }
});

$('dot').onclick = () => (state === 'recording' ? stop() : start());

// Wird das offene Fenster per Alt+1 wieder nach vorn geholt, startet die nächste Aufnahme.
window.addEventListener('focus', () => {
  if ((state === 'idle' || state === 'done' || state === 'error') && !$('setup').open) start();
});

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
