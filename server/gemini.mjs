// Gemini provider for EvacPrint AI (server side, REST over fetch).
// The browser keeps the conversation in the same message format for every
// provider; this module translates it to Gemini `contents`, streams the reply,
// and translates it back. Gemini 3+ requires the model's thought signatures to
// be returned with function calls, so the raw model parts are kept verbatim in
// a `provider_raw` block (tagged with the model that produced them) and
// replayed unchanged when the same model answers the next request.
//
// Free-tier models are sometimes overloaded (HTTP 503) or slow to respond, so
// every request has timeouts and falls back to another free model.

export const GEMINI_DEFAULT_MODEL = 'gemini-3.5-flash-lite';
const FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'];
const BASE = process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
const SKIP_SIG = 'skip_thought_signature_validator';
const FIRST_BYTE_MS = +process.env.GEMINI_TIMEOUT_MS || 25000; // time allowed until the response starts
const IDLE_MS = 30000; // max silence while a reply is streaming

export class GeminiError extends Error {
  constructor(status, message, retryable = false) { super(message); this.status = status; this.retryable = retryable; }
}

function friendly(status, body) {
  const msg = body?.error?.message || '';
  if (status === 400 && /api key/i.test(msg)) return 'Google rejected the Gemini API key configured on the EvacPrint server.';
  if (status === 401 || status === 403) return 'Google rejected the Gemini API key configured on the EvacPrint server (or the key lacks access to this model).';
  if (status === 404) return `The Gemini model is not available to this key${msg ? `: ${msg}` : ''}. Set GEMINI_MODEL to another model.`;
  if (status === 429) return 'Gemini free-tier limit reached. Wait a minute (or until the daily quota resets) and try again.';
  if (status === 503) return 'Gemini’s free models are overloaded right now (Google reports high demand). Try again in a minute.';
  if (status >= 500) return `Gemini service error (${status}). Try again shortly.`;
  return `Gemini rejected the request: ${msg || `HTTP ${status}`}`;
}
const retryableStatus = (s) => s === 429 || s === 500 || s === 503 || s === 504 || s === 404;

/** models to try, the configured one first */
export function modelChain(model) {
  return [model, ...FALLBACK_MODELS].filter((m, i, a) => m && a.indexOf(m) === i);
}

/** JSON Schema → the OpenAPI subset accepted by functionDeclarations.parameters */
function toParamSchema(s) {
  if (Array.isArray(s)) return s.map(toParamSchema);
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'additionalProperties' || k === 'eager_input_streaming') continue;
    out[k] = typeof v === 'object' ? toParamSchema(v) : v;
  }
  return out;
}

export function geminiTools(tools) {
  return [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: toParamSchema(t.input_schema) })) }];
}

/**
 * Provider-neutral history (Anthropic-style blocks) → Gemini contents.
 * Raw parts (with thought signatures) are replayed only to the model that made them;
 * for any other model the turn is rebuilt from its text and tool calls.
 */
export function toContents(messages, model) {
  const nameById = {};
  const contents = [];
  const push = (role, parts) => {
    if (!parts.length) return;
    const last = contents.at(-1);
    if (last && last.role === role) last.parts.push(...parts); else contents.push({ role, parts });
  };
  for (const m of messages) {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content || [];
    if (m.role === 'assistant') {
      for (const b of blocks) if (b.type === 'tool_use') nameById[b.id] = b.name;
      const raw = blocks.find((b) => b.type === 'provider_raw' && b.provider === 'gemini');
      if (raw && (!raw.model || raw.model === model)) { push('model', raw.parts); continue; }
      const parts = [];
      let first = true;
      for (const b of blocks) {
        if (b.type === 'text' && b.text) parts.push({ text: b.text });
        else if (b.type === 'tool_use') { parts.push({ functionCall: { id: b.id, name: b.name, args: b.input || {} }, ...(first ? { thoughtSignature: SKIP_SIG } : {}) }); first = false; }
      }
      push('model', parts);
    } else {
      const parts = [];
      // function responses first, then any text (context) after them
      for (const b of blocks) if (b.type === 'tool_result') {
        let result = b.content;
        if (Array.isArray(result)) result = result.map((c) => c.text || '').join('\n');
        try { result = JSON.parse(result); } catch { /* keep text */ }
        const response = b.is_error ? { error: result } : { result };
        parts.push({ functionResponse: { name: nameById[b.tool_use_id] || 'unknown', ...(String(b.tool_use_id).startsWith('gem_') ? {} : { id: b.tool_use_id }), response } });
      }
      for (const b of blocks) if (b.type === 'text' && b.text) parts.push({ text: b.text });
      push('user', parts);
    }
  }
  return contents;
}

const thinking = (model, level) => (/^gemini-(3|4)/.test(model) ? { thinkingConfig: { thinkingLevel: level } } : {});

/** POST with a first-byte timeout, also aborting when the caller's signal aborts */
async function post(url, key, body, outer) {
  const ac = new AbortController();
  const onOuter = () => ac.abort();
  outer?.addEventListener('abort', onOuter);
  const timer = setTimeout(() => ac.abort(), FIRST_BYTE_MS);
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, body: JSON.stringify(body), signal: ac.signal });
    if (!r.ok) {
      let b = null;
      try { b = await r.json(); } catch { /* ignore */ }
      throw new GeminiError(r.status, friendly(r.status, b), retryableStatus(r.status));
    }
    return { r, ac };
  } catch (e) {
    if (e instanceof GeminiError) throw e;
    if (outer?.aborted) throw e;
    if (e.name === 'AbortError') throw new GeminiError(504, 'Gemini did not respond in time (the free models may be busy). Try again in a minute.', true);
    throw new GeminiError(502, `Could not reach Gemini from the EvacPrint server: ${e.message}`, true);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onOuter);
  }
}

async function streamOnce({ key, model, system, messages, tools, signal, onText, maxTokens }) {
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: toContents(messages, model),
    tools: geminiTools(tools),
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    generationConfig: { maxOutputTokens: maxTokens, ...thinking(model, 'low') },
  };
  const { r, ac } = await post(`${BASE}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, key, body, signal);
  const onOuter = () => ac.abort();
  signal?.addEventListener('abort', onOuter);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  const parts = [];
  let finish = null, blocked = null, usage = null, version = model, started = false;
  const handle = (chunk) => {
    if (chunk.promptFeedback?.blockReason) blocked = chunk.promptFeedback.blockReason;
    const cand = chunk.candidates?.[0];
    if (cand?.finishReason) finish = cand.finishReason;
    if (chunk.usageMetadata) usage = chunk.usageMetadata;
    if (chunk.modelVersion) version = chunk.modelVersion;
    for (const p of cand?.content?.parts || []) {
      parts.push(p);
      if (p.text && !p.thought) { started = true; onText?.(p.text); }
    }
  };
  try {
    for (;;) {
      let idle;
      const { done, value } = await Promise.race([
        reader.read(),
        new Promise((_, rej) => { idle = setTimeout(() => rej(new GeminiError(504, 'Gemini stopped responding in the middle of a reply. Please try again.', !started)), IDLE_MS); }),
      ]).finally(() => clearTimeout(idle));
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let k;
      while ((k = buf.search(/\r?\n\r?\n/)) >= 0) {
        const ev = buf.slice(0, k);
        buf = buf.slice(k).replace(/^\r?\n\r?\n/, '');
        const data = ev.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
        if (data) handle(JSON.parse(data));
      }
    }
    if (buf.trim().startsWith('data:')) handle(JSON.parse(buf.trim().slice(5)));
  } catch (e) {
    ac.abort();
    if (e instanceof GeminiError) throw e;
    if (signal?.aborted) throw e;
    throw new GeminiError(502, `The Gemini reply was interrupted: ${e.message}`, !started);
  } finally {
    signal?.removeEventListener('abort', onOuter);
  }

  const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('');
  const calls = parts.filter((p) => p.functionCall);
  const content = [];
  if (text) content.push({ type: 'text', text });
  calls.forEach((p, i) => content.push({ type: 'tool_use', id: p.functionCall.id || `gem_${Date.now().toString(36)}_${i}`, name: p.functionCall.name, input: p.functionCall.args || {} }));
  content.push({ type: 'provider_raw', provider: 'gemini', model, parts });
  const refused = blocked || ['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION'].includes(finish);
  const stop_reason = refused ? 'refusal' : calls.length ? 'tool_use' : finish === 'MAX_TOKENS' ? 'max_tokens' : 'end_turn';
  if (finish === 'MALFORMED_FUNCTION_CALL' && !text && !calls.length) content.unshift({ type: 'text', text: 'I tried to use an app action but produced an invalid request. Please rephrase or try again.' });
  return { content, stop_reason, model: version, usage: { input: usage?.promptTokenCount, output: usage?.candidatesTokenCount } };
}

/**
 * Stream one assistant turn, trying the configured model and then the free
 * fallbacks when a model is overloaded, rate-limited or too slow to start.
 */
export async function geminiChat({ key, model, system, messages, tools, signal, onText, maxTokens = 4096 }) {
  let last;
  for (const m of modelChain(model)) {
    let sent = false;
    try {
      return await streamOnce({ key, model: m, system, messages, tools, signal, maxTokens, onText: (t) => { sent = true; onText?.(t); } });
    } catch (e) {
      last = e;
      // retry only if nothing reached the user yet and the error is transient
      if (sent || signal?.aborted || !(e instanceof GeminiError) || !e.retryable) throw e;
    }
  }
  throw last;
}

/** One-shot structured extraction with images (blueprint drafting), with fallback. */
export async function geminiStructured({ key, model, prompt, images, schema, signal }) {
  let last;
  for (const m of modelChain(model)) {
    try {
      const body = {
        contents: [{ role: 'user', parts: [...images.map((i) => ({ inlineData: { mimeType: i.media_type, data: i.data } })), { text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseJsonSchema: schema, maxOutputTokens: 16000, ...thinking(m, 'medium') },
      };
      const { r } = await post(`${BASE}/models/${encodeURIComponent(m)}:generateContent`, key, body, signal);
      const j = await r.json();
      if (j.promptFeedback?.blockReason) throw new GeminiError(422, 'Gemini declined to analyse these images.');
      const cand = j.candidates?.[0];
      if (['SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_SAFETY'].includes(cand?.finishReason)) throw new GeminiError(422, 'Gemini declined to analyse these images.');
      const text = (cand?.content?.parts || []).filter((p) => p.text && !p.thought).map((p) => p.text).join('');
      try { return { data: JSON.parse(text), model: j.modelVersion || m }; } catch { throw new GeminiError(502, 'Gemini did not return a valid blueprint.', true); }
    } catch (e) {
      last = e;
      if (!(e instanceof GeminiError) || !e.retryable || signal?.aborted) throw e;
    }
  }
  throw last;
}
