// Builds the EvacPrint handbook PDFs from the HTML sources in this folder.
//   node docs/handbook/build.mjs
// 1. joins parts/*.html into the handbook HTML, 2. prints it with headless Edge,
// 3. reads which page each chapter starts on (pdf.js), 4. writes those numbers
// into the table of contents and prints again. The checklist is printed as is.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');
const EDGE = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find(existsSync);
const NAME = 'EvacPrint_Complete_Project_Guide_and_Presentation_Playbook';
const profile = join(tmpdir(), 'evacprint-pdf-profile');
mkdirSync(profile, { recursive: true });

function print(html, pdf) {
  execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--allow-file-access-from-files', '--no-pdf-header-footer',
    '--virtual-time-budget=20000', `--print-to-pdf=${pdf}`, pathToFileURL(html).href,
  ], { stdio: 'ignore', timeout: 180000 });
}

async function pageTexts(pdf) {
  const pdfjs = await import(pathToFileURL(join(root, 'node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(pdf)), verbosity: 0 }).promise;
  const out = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(tc.items.map((t) => t.str).join(' '));
  }
  return out;
}

const parts = readdirSync(join(here, 'parts')).filter((f) => f.endsWith('.html')).sort();
let html = parts.map((f) => readFileSync(join(here, 'parts', f), 'utf8')).join('\n');
const htmlPath = join(here, `${NAME}.html`);
const pdfPath = join(here, `${NAME}.pdf`);

// pass 1
writeFileSync(htmlPath, html);
print(htmlPath, pdfPath);
const texts = await pageTexts(pdfPath);
const ids = [...html.matchAll(/<section class="chapter" id="(c[\w]+)"[\s\S]*?<div class="ch-num">([^<]+)<\/div>/g)].map((m) => [m[1], m[2].trim()]);
const pageOf = {};
const flat = texts.map((t) => t.replace(/\s+/g, '').toUpperCase());
for (const [id, label] of ids) {
  const key = label.replace(/\s+/g, '').toUpperCase();
  const k = flat.findIndex((t, i) => i > 1 && new RegExp(`${key}(?![0-9B])`).test(t));
  if (k >= 0) pageOf[id] = k + 1;
}
// pass 2: page numbers into the contents
html = html.replace(/<a href="#(c[\w]+)">([\s\S]*?)<\/a>/g, (m, id, inner) => `<a href="#${id}">${inner}<span class="pg">${pageOf[id] ?? ''}</span></a>`);
writeFileSync(htmlPath, html);
print(htmlPath, pdfPath);
console.log(`${NAME}.pdf: ${texts.length} pages`, pageOf);

// checklist
const cl = join(here, 'EvacPrint_Last_Minute_Rehearsal_Checklist.html');
if (existsSync(cl)) {
  print(cl, join(here, 'EvacPrint_Last_Minute_Rehearsal_Checklist.pdf'));
  console.log('checklist pages:', (await pageTexts(join(here, 'EvacPrint_Last_Minute_Rehearsal_Checklist.pdf'))).length);
}
