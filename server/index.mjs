// Production server: serves the built app from ./dist and the EvacPrint AI API.
//   npm run build && npm start      (set ANTHROPIC_API_KEY to enable AI)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAssistantHandler } from './assistant.mjs';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = +process.env.PORT || 4173;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.json': 'application/json', '.map': 'application/json' };
const ai = createAssistantHandler();

http.createServer(async (req, res) => {
  if (req.url.startsWith('/api/assistant')) return ai(req, res, () => { res.statusCode = 404; res.end(); });
  try {
    const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^([/\\])+/, '');
    let file = join(root, path);
    if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
    if (!(await stat(file).catch(() => null))?.isFile()) file = join(root, 'index.html');
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(await readFile(file));
  } catch { res.statusCode = 500; res.end('Server error'); }
}).listen(port, () => console.log(`EvacPrint on http://localhost:${port} — AI ${process.env.ANTHROPIC_API_KEY ? 'enabled' : 'not configured'}`));
