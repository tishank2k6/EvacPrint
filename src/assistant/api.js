// Client for the EvacPrint AI backend (same-origin /api/assistant/*).
// The browser never sees an API key: requests go to our own server, which
// holds the key and calls Claude.
let statusCache = null;

export async function aiStatus(force = false) {
  if (statusCache && !force) return statusCache;
  try {
    const r = await fetch('/api/assistant/status', { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    statusCache = await r.json();
  } catch (e) {
    statusCache = { configured: false, reachable: false, reason: 'The EvacPrint AI server is not running (static hosting or offline).' };
  }
  return statusCache;
}

/** Streams one assistant turn. Calls onText(delta) as text arrives; resolves with the final message. */
export async function chatTurn({ messages, context, level, mode }, { onText, signal } = {}) {
  const r = await fetch('/api/assistant/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, context, level, mode }),
    signal,
  });
  if (!r.ok || !r.body) {
    let msg = `HTTP ${r.status}`;
    try { msg = (await r.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let final = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let k;
    while ((k = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, k);
      buf = buf.slice(k + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const ev = JSON.parse(line.slice(6));
      if (ev.type === 'text') onText?.(ev.text);
      else if (ev.type === 'final') final = ev.message;
      else if (ev.type === 'error') throw new Error(ev.error);
    }
  }
  if (!final) throw new Error('The response ended unexpectedly.');
  return final;
}

export async function aiBlueprint({ images, hint, labels, widthM, heightM }) {
  const r = await fetch('/api/assistant/blueprint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ images, hint, labels, widthM, heightM }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}
