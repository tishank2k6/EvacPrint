import { defineConfig, loadEnv } from 'vite';
import { createAssistantHandler } from './server/assistant.mjs';

// EvacPrint AI backend runs inside the Vite dev/preview server as middleware.
// Only server-side code reads ANTHROPIC_API_KEY / GEMINI_API_KEY (from the environment or
// .env.local); Vite exposes nothing to the browser unless it is VITE_-prefixed.
function evacprintAI(env) {
  const handler = createAssistantHandler({ apiKey: env.ANTHROPIC_API_KEY, geminiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY, geminiModel: env.GEMINI_MODEL });
  // block body: returning a function from configureServer would register it as a post-hook
  const mount = (server) => { server.middlewares.use('/api/assistant', handler); };
  return { name: 'evacprint-ai', configureServer: mount, configurePreviewServer: mount };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [evacprintAI(env)],
    worker: { format: 'es' },
    build: { target: 'es2020', chunkSizeWarningLimit: 700 },
    server: { port: 5173 },
  };
});
