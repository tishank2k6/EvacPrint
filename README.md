# EvacPrint

**Digital blueprint for crowd evacuation and safer venues.** EvacPrint simulates how a crowd leaves a venue, finds the bottlenecks, and re-runs the evacuation for every design change it can make, ranking the changes by seconds saved. It ships with a model of MSIT Seminar Hall 406, and Venue Studio lets you build your own venue.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

- On the sign-in page, choose **Enter the demo** to get straight in without registering.
- `npm run build` then `npm start` serves the production build plus the AI API on http://localhost:4173. Fonts are self-hosted, so the app works offline (AI features need internet).
- `npm run test:sim` runs all four built-in scenarios headless and fails if anyone is left inside (`-- --recommend` also runs the what-if analysis).
- `npm run illustrations` regenerates the standalone SVGs in `illustrations/` from real engine runs.

### Enabling EvacPrint AI (optional)

EvacPrint AI works with either of two providers. Set one of them:

| Provider | Cost | Key | Default model |
|---|---|---|---|
| **Google Gemini** | Free tier (rate-limited; Google may use free-tier prompts to improve its products) | `GEMINI_API_KEY` from https://aistudio.google.com/apikey | `gemini-3.5-flash-lite`, falling back to `gemini-3.1-flash-lite` / `gemini-3.8-flash` when busy (change with `GEMINI_MODEL`) |
| **Anthropic Claude** | Paid | `ANTHROPIC_API_KEY` | `claude-opus-5-5` |

1. Copy `.env.example` to `.env.local` in the project folder.
2. Fill in one of the keys.
3. Restart `npm run dev` (or `npm start`). The assistant header then shows "Connected · Gemini" or "Connected · Claude". If both keys are set, Claude is used.

Keys are read only by the EvacPrint server (`server/assistant.mjs`, `server/gemini.mjs`). Vite never exposes them to the browser, and the browser only calls `/api/assistant/*` on the same origin; the Gemini key is sent to Google in a request header, not the URL. Without a key, the assistant shows a setup screen and a clearly labelled **offline guide**. The offline guide answers from live simulation data using set phrases; it is not an AI.

## What's in it

| Area | What it does |
|---|---|
| **Simulator** | Four scenarios (normal, Door B blocked, 400 people, mixed mobility). Controls for occupancy, reaction time and panic. You can block or unblock doors and edit the layout. 2D / 3D / split views, live metrics, bottlenecks, an automatic risk analysis, recommendations with details and trade-offs, before/after comparison, and saved reports. Keys: Space = run/pause, S = step, R = reset, 1/2/3 = view. |
| **3D View** | A Three.js cutaway built from the same grid. Agents, density, exit status and time come from the same simulation instance as the 2D plan. |
| **Venue Studio** | Build a digital venue in one of four ways: camera capture, photo or video upload, floor-plan import, or drawing it manually. Then: an editable blueprint, a 3D model generated from it, a 10-step configuration wizard, simulation runs (several seeds), risk analysis, design-change testing, run comparison, saved scenarios and reports. |
| **EvacPrint AI** | A voice and text assistant on every page, grounded in the live app state. Actions that change anything ask for confirmation first, and what-if tests run on a copy of the layout. |
| **How It Works** | A clickable 10-step system flowchart, plus pathfinding, recommendation and evacuation workflows. The evacuation timings are measured. |
| **Technology** | Model card with parameters and sources, computed technical diagrams, architecture, and limitations. |
| **Learn** | Eight animated explainers (with captions and a transcript) replaying real engine runs, four interactive labs, and ten concept diagrams. |
| **Reports** | Per-user saved reports with print/PDF export. Venue reports add venue details, a 3D preview, population, mobility, emergency, exits, assumptions and risk findings. |
| **Accounts** | Demo authentication only: PBKDF2-hashed passwords stored in this browser, with recovery codes. Clearly labelled as not production security. |

### Venue Studio details

- **Capture:** the camera starts only after you press the button and allow access. A guided checklist covers the overview, opposite corner, entrances, exits, corridors and obstacles, with retake and delete. You can also upload JPG / PNG / WEBP photos, or MP4 / WebM video (8 representative frames are extracted).
- **Floor plans:**
  - Supported formats: PDF (first page, rendered with pdf.js), PNG, JPG, WEBP, SVG and DXF (LINE / LWPOLYLINE / POLYLINE / ARC; units come from `$INSUNITS` or are asked for).
  - DWG is refused, with a message to export it as DXF or PDF.
  - Calibrate the scale by clicking two points and typing the real length.
  - **Trace walls** turns dark lines into walls. It is deterministic image processing, not AI.
  - Openings must be placed by you, because tracing cannot tell a doorway from a gap.
- **AI-assisted draft (needs the key):** sends the plan or photos to Claude. The structured result becomes editable rooms, walls, doors, exits, seating and obstacles. Estimated sizes are marked unverified.
- **Engine hooks:** the wizard maps onto the existing engine:
  - population profiles (age, mobility, staff and security);
  - where people start (seats, standing, corridors, near entrances, room by room);
  - exit width, flow, open/closed and step-free status;
  - unfamiliar occupants preferring the main entrance;
  - slow zones (stairs, ramps, smoke, water) and closed zones (fire, debris, restricted);
  - lighting, visibility and floor-condition speed factors;
  - detection and alarm delays.

  Unsupported hazard physics (fire spread, toxicity, collapse, water flow) are listed as assumptions, never simulated.

## Model (summary)

- **Grid:** 0.5 m cells. Agents move in continuous space.
- **Routing:** per-exit Dijkstra fields, recomputed every 2 s with a congestion cost.
- **Speed:** Weidmann (1993) speed–density relation, with collisions between bodies.
- **Doors:** limited to 1.33 persons/s per metre of clear width.
- **Density:** Gaussian kernel, R = 0.7 m (Helbing et al. 2007).
- **Bottlenecks:** zones at or above 2.15 p/m² (Fruin LOS F) lasting 3 s or more.
- **Panic:** faster walking and reactions, less rerouting, and door clogging, which reproduces the faster-is-slower effect.

Every number shown in the UI comes from a simulation run. Comparisons use identical seeds, and a recommendation is only marked as a consistent gain when it helps on all 3 seeds.

**Limitations:** this is a comparative planning tool, not a certification method. It doesn't model fire or smoke spread, separate floors, group cohesion or counter-flow. Hall 406 dimensions are a planning model and need to be verified on site. Risk findings are model estimates, not a safety assessment.

## Layout

```
src/sim/        engine, pathfinding, layout (+ extended design changes), scenarios, recommend, risk, worker, controller
src/venue/      venue model + rasteriser, blueprint editor, wizard, capture, importers, IndexedDB store
src/assistant/  EvacPrint AI client: panel + voice, live context, tools, offline guide, API client
server/         assistant.mjs (AI proxy: chat SSE + blueprint drafting), gemini.mjs (Gemini provider), index.mjs (production server)
src/render/     floorplan.js (2D), view3d.js (3D, lazy), iso.js, charts.js, colors.js
src/learn/      explainers, player, labs, mini rooms
src/pages/      one module per route
scripts/        sim-check.mjs, render-illustrations.mjs
illustrations/  generated SVGs
```
