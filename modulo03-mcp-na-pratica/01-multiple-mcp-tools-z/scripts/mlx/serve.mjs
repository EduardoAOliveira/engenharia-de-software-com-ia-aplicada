#!/usr/bin/env node
// Sobe o mlx_lm.server (LLM local) E um dashboard de acompanhamento, juntos.
// Um comando: `npm run mlx:serve`. O dashboard fica em http://127.0.0.1:8091
//
// O launcher é dono do processo do LLM: ele o inicia, captura o stdout/stderr,
// parseia as linhas de log em métricas ao vivo e as reemite para o navegador via
// Server-Sent Events. As chamadas /v1/* do dashboard são proxiadas para o LLM
// (mesma origem — sem CORS).

import { spawn } from 'node:child_process';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));

const MLX_PORT = Number(process.env.MLX_PORT ?? 8090);
const DASH_PORT = Number(process.env.MLX_DASH_PORT ?? 8091);
const MODEL = process.env.MLX_MODEL ?? 'mlx-community/Qwen2.5-7B-Instruct-4bit';
const PYTHON = process.env.MLX_PYTHON ?? join(homedir(), 'mlx-lm-server-venv', 'bin', 'python');
const LOG_LEVEL = process.env.MLX_LOG_LEVEL ?? 'INFO';

// ── estado ao vivo, alimentado pelos logs do mlx_lm.server ──────────────────
const state = {
  status: 'starting',        // starting | online | offline
  model: MODEL,
  requests: 0,               // nº de POST /v1/chat/completions atendidos
  prompt: null,              // { done, total } enquanto processa o prompt
  cache: null,               // "N sequences, X GB"
  startedAt: Date.now(),
  lastActivity: Date.now(),
};

const clients = new Set();   // conexões SSE abertas
const ring = [];             // últimas linhas de log (buffer circular)
const RING_MAX = 200;

function emit(event) {
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(line);
}

function pushLog(level, text) {
  const entry = { t: Date.now(), level, text };
  ring.push(entry);
  if (ring.length > RING_MAX) ring.shift();
  emit({ type: 'log', ...entry });
}

function snapshot() {
  return { type: 'state', ...state, uptime: Date.now() - state.startedAt };
}

// ── parsing das linhas de log do mlx_lm.server ──────────────────────────────
function parseLogLine(raw) {
  const text = raw.trimEnd();
  if (!text) return;

  const level = /- (DEBUG|INFO|WARNING|ERROR|CRITICAL) -/.exec(text)?.[1]
    ?? (/Traceback|Error/.test(text) ? 'ERROR' : 'INFO');

  // servidor pronto
  if (/Starting httpd/.test(text)) {
    state.status = 'online';
    emit(snapshot());
  }
  // request atendido
  const m = /"POST \/v1\/chat\/completions[^"]*"\s+(\d+)/.exec(text);
  if (m) {
    state.requests += 1;
    state.lastActivity = Date.now();
    state.prompt = null;
    emit(snapshot());
  }
  // processamento do prompt em andamento
  const p = /Prompt processing progress:\s*(\d+)\/(\d+)/.exec(text);
  if (p) {
    state.prompt = { done: Number(p[1]), total: Number(p[2]) };
    state.lastActivity = Date.now();
    emit(snapshot());
  }
  // cache de prompt
  const c = /Prompt Cache:\s*(.+)$/.exec(text);
  if (c) {
    state.cache = c[1];
    emit(snapshot());
  }

  pushLog(level, text.replace(/^.*?- (DEBUG|INFO|WARNING|ERROR|CRITICAL) - /, ''));
}

// ── spawn do LLM ────────────────────────────────────────────────────────────
console.log(`⧗ iniciando mlx_lm.server (${MODEL}) na porta ${MLX_PORT}...`);
const mlx = spawn(
  PYTHON,
  ['-m', 'mlx_lm', 'server', '--model', MODEL, '--port', String(MLX_PORT),
    '--host', '127.0.0.1', '--log-level', LOG_LEVEL],
  { stdio: ['ignore', 'pipe', 'pipe'] },
);

let buf = '';
function onChunk(chunk) {
  buf += chunk.toString();
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    parseLogLine(buf.slice(0, i));
    buf = buf.slice(i + 1);
  }
}
mlx.stdout.on('data', onChunk);
mlx.stderr.on('data', onChunk);
mlx.on('exit', (code) => {
  state.status = 'offline';
  emit(snapshot());
  console.log(`✗ mlx_lm.server encerrou (código ${code})`);
  process.exit(code ?? 0);
});

// health check periódico (confirma que o endpoint responde de fato)
async function ping() {
  try {
    const r = await fetch(`http://127.0.0.1:${MLX_PORT}/health`, { signal: AbortSignal.timeout(2000) });
    if (r.ok && state.status !== 'online') { state.status = 'online'; emit(snapshot()); }
  } catch { /* ainda subindo */ }
}
setInterval(ping, 3000);
setInterval(() => emit(snapshot()), 1000); // tick de uptime

// ── proxy simples /v1/* → mlx_lm.server ─────────────────────────────────────
function proxy(req, res) {
  const upstream = http.request(
    { host: '127.0.0.1', port: MLX_PORT, path: req.url, method: req.method, headers: req.headers },
    (up) => { res.writeHead(up.statusCode ?? 502, up.headers); up.pipe(res); },
  );
  upstream.on('error', (e) => { res.writeHead(502); res.end(JSON.stringify({ error: e.message })); });
  req.pipe(upstream);
}

// ── servidor do dashboard ───────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = req.url ?? '/';

  if (url === '/' || url === '/index.html') {
    try {
      const html = await readFile(join(__dirname, 'dashboard.html'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch (e) {
      res.writeHead(500); res.end(String(e));
    }
    return;
  }

  if (url === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    clients.add(res);
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    for (const e of ring.slice(-40)) res.write(`data: ${JSON.stringify({ type: 'log', ...e })}\n\n`);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (url.startsWith('/v1/')) return proxy(req, res);

  res.writeHead(404); res.end('not found');
});

server.listen(DASH_PORT, '127.0.0.1', () => {
  const dashUrl = `http://127.0.0.1:${DASH_PORT}`;
  console.log(`◉ dashboard: ${dashUrl}`);
  // abre o navegador (macOS)
  spawn('open', [dashUrl], { stdio: 'ignore' }).on('error', () => {});
});

// encerra o LLM junto ao Ctrl-C
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { mlx.kill('SIGTERM'); server.close(); process.exit(0); });
}
