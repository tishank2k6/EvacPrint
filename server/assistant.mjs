// EvacPrint AI — server side. Holds the Anthropic API key (never sent to the
// browser), streams assistant turns over Server-Sent Events, and turns floor
// plans / photos into an editable draft blueprint with structured outputs.
// Mounted as middleware by Vite (dev + preview) and by server/index.mjs.
import Anthropic from '@anthropic-ai/sdk';
import { geminiChat, geminiStructured, GeminiError, GEMINI_DEFAULT_MODEL } from './gemini.mjs';

const MODEL = process.env.EVACPRINT_AI_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.EVACPRINT_AI_EFFORT || 'low'; // chat is latency-sensitive
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// ---------------------------------------------------------------- tools (executed in the browser)
export const TOOLS = [
  { name: 'get_simulation_snapshot', description: 'Read the latest live state of the EvacPrint simulator (time, evacuated count, exits, queues, bottlenecks, results, recommendations). Read-only. Use it when the context in the conversation may be stale.', input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false } },
  { name: 'highlight_area', description: 'Highlight a location on the 2D plan and 3D model so the user can see what you are talking about. Read-only. Target either an opening by name, a live bottleneck (B1, B2…), a risk finding number, or explicit coordinates in metres.', input_schema: { type: 'object', properties: { target: { type: 'string', description: 'Opening name (e.g. "Door B"), "B1", "risk 2", or empty when using x/y' }, x: { type: 'number' }, y: { type: 'number' }, label: { type: 'string' } }, required: ['label'], additionalProperties: false } },
  { name: 'navigate', description: 'Open an EvacPrint page. Read-only.', input_schema: { type: 'object', properties: { page: { type: 'string', enum: ['overview', 'simulator', '3d', 'venues', 'how-it-works', 'technology', 'learn', 'reports'] } }, required: ['page'], additionalProperties: false } },
  { name: 'open_learning', description: 'Open an interactive explainer or lab on the Learn page. Read-only.', input_schema: { type: 'object', properties: { topic: { type: 'string', enum: ['evac-sim', 'dijkstra', 'abm', 'bottleneck', 'density', 'fis', 'width', 'twin', 'lab-dijkstra', 'lab-width', 'lab-density', 'lab-exits'] } }, required: ['topic'], additionalProperties: false } },
  { name: 'set_scenario', description: 'Switch the live simulator to one of the four built-in Seminar Hall 406 scenarios and reset it. Changes app state: the user must confirm.', input_schema: { type: 'object', properties: { scenario: { type: 'string', enum: ['normal', 'blocked', 'large', 'mixed'] } }, required: ['scenario'], additionalProperties: false } },
  { name: 'run_simulation', description: 'Reset and start the live simulation with the current settings. The user must confirm.', input_schema: { type: 'object', properties: { speed: { type: 'number', description: 'Playback speed 1, 2, 4 or 8' } }, required: [], additionalProperties: false } },
  { name: 'set_exit_blocked', description: 'Block or reopen a door/exit in the live simulator. Changes the live layout: the user must confirm.', input_schema: { type: 'object', properties: { exit: { type: 'string' }, blocked: { type: 'boolean' } }, required: ['exit', 'blocked'], additionalProperties: false } },
  { name: 'set_occupancy', description: 'Change the number of occupants in the live simulator. The user must confirm.', input_schema: { type: 'object', properties: { count: { type: 'integer' } }, required: ['count'], additionalProperties: false } },
  { name: 'what_if', description: 'Test a change on a COPY of the current layout without touching the user’s venue: runs the baseline and the modified copy headless (same seed) and returns both results. Use for wider exits, blocked exits, more people, or a different age mix. The user must confirm because it runs simulations.', input_schema: { type: 'object', properties: { description: { type: 'string', description: 'Short human description of the change' }, block_exits: { type: 'array', items: { type: 'string' } }, open_exits: { type: 'array', items: { type: 'string' } }, widen_exit: { type: 'string', description: 'Opening name to widen by 1.0 m' }, occupants: { type: 'integer' }, slow_fraction: { type: 'number', description: '0–0.6 share of reduced-mobility occupants (e.g. more seniors)' }, panic: { type: 'number' } }, required: ['description'], additionalProperties: false } },
  { name: 'compare_scenarios', description: 'Run two built-in scenarios headless with the same seed and return a comparison. The user must confirm.', input_schema: { type: 'object', properties: { a: { type: 'string', enum: ['normal', 'blocked', 'large', 'mixed'] }, b: { type: 'string', enum: ['normal', 'blocked', 'large', 'mixed'] } }, required: ['a', 'b'], additionalProperties: false } },
  { name: 'run_recommendations', description: 'Run the EvacPrint recommendation engine on the current layout (tests every applicable design change on 3 seeds). The user must confirm.', input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false } },
  { name: 'generate_report', description: 'Save a report of the most recent completed simulation run and open it. The user must confirm.', input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false } },
].map((t) => ({ ...t, eager_input_streaming: true }));

const LEVELS = {
  beginner: 'Explain for a beginner: plain words, short sentences, one everyday analogy, no formulas unless asked.',
  intermediate: 'Explain for an engineering student: name the concept, give the key numbers and a short worked example.',
  advanced: 'Explain at an advanced technical level: name algorithms and models, give equations, parameters and their sources, and discuss limitations.',
};

const SYSTEM = `You are EvacPrint AI, the built-in assistant of EvacPrint — a browser-based crowd-evacuation simulator and venue-planning tool built for the RoboForge Open Innovation Hackathon (MSIT). You help people operate the app, understand the science, and interpret THEIR current simulation.

How EvacPrint works (use these facts; do not invent others):
- Venues are rasterised to a 0.5 m grid (wall, floor, seat, obstacle, stage, door, exit). The built-in venue is a representative model of MSIT Seminar Hall 406 (21 × 15 m, 340 seats, Doors A/B/C, exits West stair / North fire stair / Lobby exit); its dimensions are a planning model awaiting on-site verification. Users can also build their own venues in Venue Studio.
- Routing: one multi-source Dijkstra distance field per open exit, 8-connected without corner cutting, wall penalty ×1.25, recomputed every 2 s with congestion cost ×(1 + 0.45 ρ). Agents pick the lowest-cost exit with hysteresis.
- Movement: continuous agents, 0.1 s steps, desired speed from the Weidmann (1993) speed–density relation (v0 1.34 m/s, ρmax 5.4 p/m²), relaxation τ = 0.5 s, position-based collision (body radius 0.22 m; wheelchair 0.36 m).
- Doors/exits discharge at most 1.33 persons/s per metre of clear width (SFPE planning value). Under panic, discharge drops as door-front density rises (phenomenological faster-is-slower model after Helbing et al. 2000).
- Density: Gaussian kernel, R = 0.7 m (Helbing et al. 2007). Heatmap bands follow Fruin levels of service: <1.08 low, 1.08–2.15 moderate (LOS E), 2.15–4 high (LOS F), ≥4 critical. Bottlenecks = zones ≥2.15 p/m² sustained ≥3 s.
- Pre-movement (reaction) time is drawn per person from the configured range. RSET = time the last person is out.
- Recommendation engine: generates applicable design changes from the layout (widen openings, unblock, add exit, move obstacles, add aisles, remove a row, step-free exits, reopen zones), re-runs the full simulation for each on 3 seeds and marks a change as a consistent gain only if it helps on every seed.
- Risk analysis flags high-density zones, congested exits, narrow passages (<1.2 m reference), closed routes, unbalanced exit use, inaccessible routes, long travel distances (45 m reference; check NBC 2016 Part 4) and delayed areas.
- Not simulated: fire/smoke spread, toxicity, structural collapse, group cohesion, separate floors. Venue Studio smoke/water zones only slow walking.

Grounding rules:
- Each user turn carries an <app_context> block with the live application state. Answer questions about "the simulation", "this venue", "Exit B" etc. ONLY from that data or from get_simulation_snapshot. Quote the actual numbers. If something is not in the data (e.g. the simulation has not been run), say so and offer to run it — never invent dimensions, counts, times or densities.
- When you mention a specific exit, bottleneck or area of the current simulation, call highlight_area so the user sees it.
- Actions that change app state or run simulations (set_scenario, run_simulation, set_exit_blocked, set_occupancy, what_if, compare_scenarios, run_recommendations, generate_report) are confirmed by the user in the app before they execute. Before calling one, say in one sentence what you are about to do. Prefer what_if (which works on a copy) over changing the user's live layout. After a tool result arrives, explain the actual outcome with its numbers.
- Safety: EvacPrint is an educational and comparative planning tool. Never present simulated results as real emergency instructions or as certification that a building is safe. If someone describes a real, ongoing emergency, tell them to follow the venue's emergency procedures and call emergency services (112 in India) — do not give simulated routes as live directions. Mark unsupported hazard physics as assumptions.

Style: conversational and concise — answers may be read aloud, so prefer short paragraphs and plain sentences; use a short bullet list only when listing several items. No headings, no tables, no emoji. Don't repeat the whole context back.`;

// ---------------------------------------------------------------- helpers
const rate = new Map();
function limited(ip, max = 40) {
  const now = Date.now();
  const r = rate.get(ip) || { n: 0, t: now };
  if (now - r.t > 60000) { r.n = 0; r.t = now; }
  r.n++;
  rate.set(ip, r);
  return r.n > max;
}
function readJSON(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}
const send = (res, status, obj) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(obj)); };
function errorMessage(e) {
  if (e instanceof GeminiError) return e.message;
  if (e instanceof Anthropic.AuthenticationError) return 'The AI service rejected the API key configured on the EvacPrint server.';
  if (e instanceof Anthropic.RateLimitError) return 'The AI service is rate-limiting requests. Wait a moment and try again.';
  if (e instanceof Anthropic.BadRequestError) return `The AI request was rejected: ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the AI service from the EvacPrint server.';
  if (e instanceof Anthropic.APIError) return `AI service error (${e.status}).`;
  return e?.message || 'Unknown error';
}

// ---------------------------------------------------------------- blueprint schema
const rect = { type: 'object', additionalProperties: false, required: ['x', 'y', 'w', 'h'], properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } } };
const opening = { type: 'object', additionalProperties: false, required: ['name', 'x', 'y', 'width_m', 'orientation'], properties: { name: { type: 'string' }, x: { type: 'number' }, y: { type: 'number' }, width_m: { type: 'number' }, orientation: { type: 'string', enum: ['horizontal', 'vertical'] } } };
const BLUEPRINT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['overall_width_m', 'overall_depth_m', 'dimensions_source', 'rooms', 'walls', 'doors', 'exits', 'seating', 'obstacles', 'stages', 'notes'],
  properties: {
    overall_width_m: { type: 'number' },
    overall_depth_m: { type: 'number' },
    dimensions_source: { type: 'string', enum: ['read_from_drawing', 'user_provided', 'estimated'] },
    rooms: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['name', 'x', 'y', 'w', 'h', 'kind'], properties: { name: { type: 'string' }, kind: { type: 'string', enum: ['room', 'corridor', 'stairs', 'ramp'] }, x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } } } },
    walls: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['x1', 'y1', 'x2', 'y2'], properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' } } } },
    doors: { type: 'array', items: opening },
    exits: { type: 'array', items: opening },
    seating: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['x', 'y', 'w', 'h', 'facing'], properties: { ...rect.properties, facing: { type: 'string', enum: ['north', 'south', 'east', 'west'] } } } },
    obstacles: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'x', 'y', 'w', 'h'], properties: { label: { type: 'string' }, ...rect.properties } } },
    stages: { type: 'array', items: rect },
    notes: { type: 'string' },
  },
};

function blueprintToShapes(bp, W, H) {
  const cl = (v) => Math.max(0, Math.min(1, +v || 0));
  const X = (v) => Math.round(cl(v) * W * 4) / 4, Y = (v) => Math.round(cl(v) * H * 4) / 4;
  const sz = (v, m) => Math.max(0.5, Math.round(cl(v) * m * 4) / 4);
  const out = [];
  for (const r of bp.rooms) out.push({ type: r.kind, name: r.name, x: X(r.x), y: Y(r.y), w: sz(r.w, W), h: sz(r.h, H), rot: 0 });
  for (const w of bp.walls) out.push({ type: 'wall', x1: X(w.x1), y1: Y(w.y1), x2: X(w.x2), y2: Y(w.y2) });
  for (const d of bp.doors) out.push({ type: 'door', name: d.name, x: X(d.x), y: Y(d.y), width: Math.max(0.5, Math.min(8, +d.width_m || 1)), rot: d.orientation === 'vertical' ? 90 : 0 });
  for (const d of bp.exits) out.push({ type: 'exit', name: d.name, x: X(d.x), y: Y(d.y), width: Math.max(0.5, Math.min(8, +d.width_m || 1)), rot: d.orientation === 'vertical' ? 90 : 0 });
  for (const s of bp.seating) out.push({ type: 'seating', x: X(s.x), y: Y(s.y), w: sz(s.w, W), h: sz(s.h, H), rot: { north: 0, east: 90, south: 180, west: 270 }[s.facing] || 0, pitch: 1 });
  for (const o of bp.obstacles) out.push({ type: 'furniture', name: o.label, x: X(o.x), y: Y(o.y), w: sz(o.w, W), h: sz(o.h, H), rot: 0 });
  for (const s of bp.stages) out.push({ type: 'stage', x: X(s.x), y: Y(s.y), w: sz(s.w, W), h: sz(s.h, H), rot: 0 });
  return out;
}

// Provider-specific blocks never go to the other provider
const stripRaw = (messages) => messages.map((m) => (Array.isArray(m.content) ? { ...m, content: m.content.filter((b) => b.type !== 'provider_raw') } : m));

function finishBlueprint(bp, body, known, model) {
  const W = known ? +body.widthM : Math.max(3, Math.min(300, +bp.overall_width_m || 20));
  const H = known ? +body.heightM : Math.max(3, Math.min(300, +bp.overall_depth_m || 15));
  const unverified = known ? [] : ['overall dimensions', 'room sizes', 'opening widths'];
  return { shapes: blueprintToShapes(bp, W, H), widthM: W, heightM: H, dimensionsSource: known ? 'user_provided' : bp.dimensions_source, unverified, notes: bp.notes, model };
}

// ---------------------------------------------------------------- handler factory
export function createAssistantHandler({ apiKey, geminiKey, geminiModel } = {}) {
  const key = (apiKey || process.env.ANTHROPIC_API_KEY || '').trim();
  const token = process.env.ANTHROPIC_AUTH_TOKEN || '';
  const gKey = (geminiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  const gModel = geminiModel || process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
  // Claude is used when its key is present; otherwise Gemini (free tier available)
  const provider = key || token ? 'claude' : gKey ? 'gemini' : null;
  const configured = !!provider;
  const client = provider === 'claude' ? new Anthropic(key ? { apiKey: key } : {}) : null;
  const modelName = provider === 'claude' ? MODEL : provider === 'gemini' ? gModel : null;

  return async function handler(req, res, next) {
    const url = (req.url || '').split('?')[0].replace(/^\/api\/assistant/, '') || '/';
    const ip = req.socket?.remoteAddress || 'local';
    try {
      if (url === '/status' && req.method === 'GET') {
        return send(res, 200, { configured, provider, reachable: true, model: modelName, voice: 'browser', reason: configured ? null : 'No ANTHROPIC_API_KEY or GEMINI_API_KEY is set on the EvacPrint server.' });
      }
      if (!['/chat', '/blueprint'].includes(url)) return next ? next() : send(res, 404, { error: 'Not found' });
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      if (!configured) return send(res, 503, { error: 'EvacPrint AI is not configured on this server (no API key).' });
      if (limited(ip, url === '/blueprint' ? 10 : 40)) return send(res, 429, { error: 'Too many requests — slow down a little.' });

      if (url === '/chat') {
        const body = await readJSON(req, 600_000);
        let messages = Array.isArray(body.messages) ? body.messages.slice(-60) : [];
        // a trimmed history must start at a plain user turn (not a tool result)
        while (messages.length && (messages[0].role !== 'user' || (Array.isArray(messages[0].content) && messages[0].content.some((b) => b.type === 'tool_result')))) messages = messages.slice(1);
        if (!messages.length || messages[0].role !== 'user') return send(res, 400, { error: 'messages must start with a user turn' });
        const level = LEVELS[body.level] || LEVELS.intermediate;
        const mode = body.mode === 'learn' ? 'The user is in Learning mode: teach step by step, check understanding with one short question at the end, and suggest the relevant explainer or lab with open_learning when one exists.' : 'The user is in Assistant mode: focus on their current venue and simulation.';
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        const sse = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
        const ac = new AbortController();
        // abort upstream only if the browser disconnects before the reply is complete
        res.on('close', () => { if (!res.writableEnded) ac.abort(); });
        try {
          if (provider === 'gemini') {
            const final = await geminiChat({ key: gKey, model: gModel, system: `${SYSTEM}

${level}
${mode}`, messages, tools: TOOLS, signal: ac.signal, onText: (t) => sse({ type: 'text', text: t }) });
            sse({ type: 'final', message: final });
            return res.end();
          }
          const stream = client.beta.messages.stream({
            model: MODEL,
            max_tokens: 8000,
            betas: [FALLBACK_BETA],
            fallbacks: 'default',
            output_config: { effort: EFFORT },
            cache_control: { type: 'ephemeral' },
            system: [{ type: 'text', text: SYSTEM }, { type: 'text', text: `${level}\n${mode}` }],
            tools: TOOLS,
            messages: stripRaw(messages),
          }, { signal: ac.signal });
          stream.on('text', (t) => sse({ type: 'text', text: t }));
          const final = await stream.finalMessage();
          sse({ type: 'final', message: { content: final.content, stop_reason: final.stop_reason, model: final.model, usage: { input: final.usage?.input_tokens, output: final.usage?.output_tokens, cache_read: final.usage?.cache_read_input_tokens } } });
        } catch (e) {
          if (!ac.signal.aborted) sse({ type: 'error', error: errorMessage(e) });
        }
        return res.end();
      }

      // ---- blueprint drafting
      const body = await readJSON(req, 24_000_000);
      const imgs = (body.images || []).slice(0, 4).filter((i) => /^image\/(png|jpeg|webp|gif)$/.test(i.media_type) && typeof i.data === 'string');
      if (!imgs.length) return send(res, 400, { error: 'No supported images (PNG, JPEG, WEBP) were sent.' });
      const known = body.widthM > 0 && body.heightM > 0;
      const labels = body.hint !== 'floor-plan' && Array.isArray(body.labels) && body.labels.length === imgs.length
        ? ` The user labelled them: ${body.labels.map((l, i) => `image ${i + 1} = ${String(l).replace(/[^\w\s/-]/g, '').slice(0, 40)}`).join('; ')}.`
        : '';
      const prompt = `${body.hint === 'floor-plan' ? 'This is an architectural floor plan.' : `These are photographs of one indoor venue taken from different angles.${labels} Infer the layout from what is visible (walls, doors, exit signs, seating, corridors); a corridor photo means a corridor connected to the main room.`}
Produce a draft 2D evacuation blueprint of the main space(s). Coordinates are FRACTIONS (0–1) of the overall width (x, left→right) and depth (y, top→bottom) of the plan bounding box. Rooms/corridors are rectangles; doors connect two spaces; exits lead outside or to a stair. Put each door/exit on the wall line it sits in (orientation = direction of that wall). Seating blocks: give the direction the audience faces. Keep about 1 m in front of every door and exit clear of furniture, stages and seating. Only include elements you can actually see; omit what you cannot determine.
${known ? `The user measured the overall size as ${body.widthM} m wide by ${body.heightM} m deep — use dimensions_source "user_provided" and these values.` : 'Read overall dimensions from dimension annotations if the drawing has them ("read_from_drawing"); otherwise estimate from typical object sizes (doors ≈ 0.9 m, seats ≈ 0.5 m) and set dimensions_source to "estimated".'}
In notes, state briefly what is uncertain.`;
      if (provider === 'gemini') {
        const g = await geminiStructured({ key: gKey, model: gModel, prompt, images: imgs, schema: BLUEPRINT_SCHEMA });
        return send(res, 200, finishBlueprint(g.data, body, known, g.model));
      }
      const resp = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: [FALLBACK_BETA],
        fallbacks: 'default',
        output_config: { effort: 'high', format: { type: 'json_schema', schema: BLUEPRINT_SCHEMA } },
        messages: [{ role: 'user', content: [...imgs.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.media_type, data: i.data } })), { type: 'text', text: prompt }] }],
      });
      if (resp.stop_reason === 'refusal') return send(res, 422, { error: 'The model declined to analyse these images.' });
      const text = resp.content.find((b) => b.type === 'text')?.text;
      let bp;
      try { bp = JSON.parse(text); } catch { return send(res, 502, { error: 'The model did not return a valid blueprint.' }); }
      return send(res, 200, finishBlueprint(bp, body, known, resp.model));
    } catch (e) {
      if (res.headersSent) { try { res.end(); } catch { /* ignore */ } return; }
      if (e instanceof GeminiError) return send(res, e.status === 429 ? 429 : e.status === 422 ? 422 : 502, { error: e.message });
      return send(res, e.status && e.status < 500 && !(e instanceof Anthropic.APIError) ? e.status : 502, { error: errorMessage(e) });
    }
  };
}
