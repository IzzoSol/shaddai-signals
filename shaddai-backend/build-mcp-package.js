#!/usr/bin/env node
/**
 * build-mcp-package.js — packages the SHADDAI RAG MCP server for sharing.
 *
 * Produces ./shaddai-mcp-dist/ containing:
 *   - the full require-graph closure of mcp-server-rag.js (48 backend files)
 *   - the real RAG knowledge bases (data/rag/kb_*), minus test namespaces
 *   - load-time data files (mcp-servers.json, skills-catalog.json, agents/, …)
 *   - package.json, setup.bat, setup.sh, README.md, .env.example, .gitignore
 *
 * Then zips it to ./shaddai-mcp-dist.zip (the file the landing page serves).
 *
 * Run from backend/:  node build-mcp-package.js
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const BACKEND = __dirname;
const ROOT = path.join(BACKEND, '..');
const DIST = path.join(BACKEND, 'shaddai-mcp-dist');
const ZIP = path.join(BACKEND, 'shaddai-mcp-dist.zip');

// ── 1. Walk the require graph from the MCP server ──────────────────────────────
function walkRequireGraph(startFile) {
  const seen = new Set();
  function walk(file) {
    const real = fs.realpathSync(file);
    if (seen.has(real)) return;
    seen.add(real);
    let src;
    try { src = fs.readFileSync(real, 'utf8'); } catch { return; }
    const base = path.dirname(real);
    const re = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(src))) {
      const target = path.resolve(base, m[1]);
      let resolved = null;
      for (const cand of [target, target + '.js', target + '.json', target + '.node', path.join(target, 'index.js')]) {
        try { if (fs.statSync(cand).isFile()) { resolved = cand; break; } } catch {}
      }
      if (!resolved) {
        try { if (fs.statSync(target).isDirectory()) resolved = path.join(target, 'index.js'); } catch {}
      }
      if (resolved) walk(resolved);
    }
  }
  walk(startFile);
  return [...seen];
}

// ── 2. Load-time data files that must ship (small, engine reads at require) ────
const REQUIRED_DATA_FILES = [
  'data/mcp-servers.json',
  'data/skills-catalog.json',
  'data/byok-keys.json',
  'data/agent-memory.json',
  'data/inbox.json',
  'data/credit-costs.json',
];
const REQUIRED_DATA_DIRS = ['data/agents'];
const KB_PREFIX = 'kb_';
const KB_DIR = path.join(BACKEND, 'data', 'rag');

// ── 3. Reset dist ──────────────────────────────────────────────────────────────
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// ── 4. Copy the closure, preserving backend/ relative layout ───────────────────
const closure = walkRequireGraph(path.join(BACKEND, 'mcp-server-rag.js'));
const copied = [];
for (const f of closure) {
  const rel = path.relative(BACKEND, f); // e.g. "lib/aura.js"
  const dest = path.join(DIST, 'backend', rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(f, dest);
  copied.push(rel);
}

// ── 5. Copy required data files ────────────────────────────────────────────────
for (const rel of REQUIRED_DATA_FILES) {
  const src = path.join(BACKEND, rel);
  if (fs.existsSync(src)) {
    const dest = path.join(DIST, 'backend', rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}
for (const rel of REQUIRED_DATA_DIRS) {
  const src = path.join(BACKEND, rel);
  if (fs.existsSync(src)) {
    fs.cpSync(src, path.join(DIST, 'backend', rel), { recursive: true });
  }
}

// ── 6. Copy the RAG knowledge bases (real kb_* only) ───────────────────────────
let kbFiles = 0, kbChars = 0;
if (fs.existsSync(KB_DIR)) {
  const namespaces = fs.readdirSync(KB_DIR).filter(n => n.startsWith(KB_PREFIX));
  for (const ns of namespaces) {
    const src = path.join(KB_DIR, ns);
    const st = fs.statSync(src);
    if (!st.isDirectory()) continue;
    fs.cpSync(src, path.join(DIST, 'backend', 'data', 'rag', ns), { recursive: true });
    const docs = path.join(src, 'docs.json');
    if (fs.existsSync(docs)) {
      try {
        const arr = JSON.parse(fs.readFileSync(docs, 'utf8'));
        kbFiles += (arr || []).length;
        kbChars += (arr || []).reduce((s, d) => s + (d.text ? d.text.length : 0), 0);
      } catch {}
    }
  }
}

// ── 7. Runtime dirs the engine creates/reads ───────────────────────────────────
fs.mkdirSync(path.join(DIST, 'generated-output'), { recursive: true });
fs.mkdirSync(path.join(DIST, 'backend', 'execution-logs'), { recursive: true });

// ── 8. package.json ────────────────────────────────────────────────────────────
fs.writeFileSync(path.join(DIST, 'package.json'), JSON.stringify({
  name: 'shaddai-mcp',
  version: '2.2.0',
  description: 'SHADDAI RAG + Agents MCP server — the 7-agent council and its mastery knowledge bases, for Claude Desktop / Claude Code / Cursor.',
  private: true,
  main: 'backend/mcp-server-rag.js',
  bin: { 'shaddai-mcp': 'backend/mcp-server-rag.js' },
  scripts: {
    start: 'node backend/mcp-server-rag.js',
    mcp: 'node backend/mcp-server-rag.js',
    self: 'node backend/mcp-server-rag.js --self-test',
    'self-full': 'node backend/mcp-server-rag.js --self-test-full',
  },
  engines: { node: '>=18' },
  dependencies: {
    axios: '^1.7.9',
    bs58: '^5.0.0',
    dotenv: '^16.4.7',
    express: '^4.21.2',
    winston: '^3.17.0',
  },
}, null, 2));

// ── 9. .env.example ────────────────────────────────────────────────────────────
fs.writeFileSync(path.join(DIST, 'backend', '.env.example'), [
  '# SHADDAI MCP — API keys. Copy this file to .env and fill in ONE key.',
  '# rag_ask / run_agent are CLOUD-FIRST: they use the first available key below',
  '# (AURA cache → Groq → Gemini → OpenRouter → Anthropic → OpenAI → local Ollama last).',
  '',
  '# FREE + FASTEST — sign up at https://console.groq.com (Groq API key, 1 minute).',
  'GROQ_API_KEY=',
  '',
  '# Optional alternates (all free tiers exist):',
  'GEMINI_API_KEY=',
  'OPENROUTER_API_KEY=',
  'ANTHROPIC_API_KEY=',
  'OPENAI_API_KEY=',
  '',
  '# Optional — local fallback when no cloud key is set (needs Ollama installed):',
  '# DEFAULT_OLLAMA_MODEL=phi4-mini',
  '# OLLAMA_API_URL=http://localhost:11434',
  '# OLLAMA_TIMEOUT_MS=120000',
  '',
  '# MCP servers that the agents may use (edit data/mcp-servers.json instead):',
  '',
].join('\n'));

// ── 10. setup.bat (Windows) ────────────────────────────────────────────────────
fs.writeFileSync(path.join(DIST, 'setup.bat'), [
  '@echo off',
  'setlocal',
  'title SHADDAI MCP — Setup',
  'cd /d "%~dp0"',
  '',
  'echo [SHADDAI MCP] Setting up the 7-agent council + RAG knowledge base...',
  'echo.',
  '',
  'where node >nul 2>nul',
  'if errorlevel 1 (',
  '  echo [ERROR] Node.js is required but was not found.',
  '  echo Install it from https://nodejs.org (LTS 18+), then run setup.bat again.',
  '  pause',
  '  exit /b 1',
  ')',
  '',
  'echo [1/3] Installing dependencies...',
  'call npm install --no-audit --no-fund',
  'if errorlevel 1 (',
  '  echo [ERROR] npm install failed.',
  '  pause',
  '  exit /b 1',
  ')',
  '',
  'if not exist "backend\\.env" (',
  '  echo [2/3] Creating backend\\.env from template...',
  '  copy "backend\\.env.example" "backend\\.env" >nul',
  '  echo   - OPEN backend\\.env and add ONE API key, e.g. GROQ_API_KEY from https://console.groq.com',
  ') else (',
  '  echo [2/3] backend\\.env already exists — leaving it alone.',
  ')',
  '',
  'echo [3/3] Self-test...',
  'call node backend/mcp-server-rag.js --self-test',
  '',
  'echo.',
  'echo Done. Start the server any time with:',
  'echo   start-mcp.bat',
  'echo Or wire it into Claude (see README.md).',
  'pause',
].join('\r\n'));

// ── 11. setup.sh (macOS / Linux) ───────────────────────────────────────────────
fs.writeFileSync(path.join(DIST, 'setup.sh'), [
  '#!/usr/bin/env bash',
  'set -e',
  'cd "$(dirname "$0")"',
  '',
  'echo "[SHADDAI MCP] Setting up the 7-agent council + RAG knowledge base..."',
  '',
  'if ! command -v node >/dev/null 2>&1; then',
  '  echo "[ERROR] Node.js is required. Install from https://nodejs.org (LTS 18+)."',
  '  exit 1',
  'fi',
  '',
  'echo "[1/3] Installing dependencies..."',
  'npm install --no-audit --no-fund',
  '',
  'if [ ! -f backend/.env ]; then',
  '  echo "[2/3] Creating backend/.env from template..."',
  '  cp backend/.env.example backend/.env',
  '  echo "  - OPEN backend/.env and add ONE API key, e.g. GROQ_API_KEY from https://console.groq.com"',
  'else',
  '  echo "[2/3] backend/.env already exists — leaving it alone."',
  'fi',
  '',
  'echo "[3/3] Self-test..."',
  'node backend/mcp-server-rag.js --self-test',
  '',
  'echo',
  'echo "Done. Start the server any time with:"',
  'echo "  ./start-mcp.sh"',
  'echo "Or wire it into Claude (see README.md)."',
].join('\n'));
fs.chmodSync(path.join(DIST, 'setup.sh'), 0o755);

// ── 12. start-mcp.bat / start-mcp.sh ───────────────────────────────────────────
fs.writeFileSync(path.join(DIST, 'start-mcp.bat'),
  '@echo off\r\ncd /d "%~dp0"\r\necho [SHADDAI MCP] Running as stdio MCP server. Add this to Claude, then keep this window open.\r\nnode backend/mcp-server-rag.js\r\n');
fs.writeFileSync(path.join(DIST, 'start-mcp.sh'),
  '#!/usr/bin/env bash\ncd "$(dirname "$0")"\necho "[SHADDAI MCP] Running as stdio MCP server. Add this to Claude, then keep this window open."\nnode backend/mcp-server-rag.js\n');
fs.chmodSync(path.join(DIST, 'start-mcp.sh'), 0o755);

// ── 13. README.md ──────────────────────────────────────────────────────────────
fs.writeFileSync(path.join(DIST, 'README.md'), [
  '# SHADDAI MCP — the 7-agent council in your Claude',
  '',
  'This package exposes SHADDAI\'s 7 AI agents and its RAG knowledge base',
  '(the YouTube-transcription mastery stores) as a **Model Context Protocol** server.',
  'Connect it to Claude Desktop, Claude Code, or Cursor and the agents become',
  'available inside your own chats — with their 3.7MB of mastery material.',
  '',
  '## What you get',
  '',
  '- **7 agents**: SHADDAI (orchestrator), NEXUS (architect), ZEROX (markets),',
  '  ORACLE (research), TURTLE (creative), QUILL (writing), PIKADON (security).',
  '- **5 tools**: `list_agents`, `list_rag_docs`, `rag_search`, `rag_ask`, `run_agent`.',
  '- **7 resources**: `kb://<agent>` — each agent\'s knowledge base, browsable.',
  '- **Knowledge bases**: real content per agent (mastery / transcriptions).',
  '- **No Ollama required**: `rag_ask` and `run_agent` are cloud-first — they use',
  '  AURA cache → Groq → Gemini → OpenRouter → Anthropic → OpenAI (first key present).',
  '  Ollama is only the last-resort fallback.',
  '',
  '## Install (one time)',
  '',
  '### Windows',
  '```bat',
  'setup.bat',
  '```',
  '',
  '### macOS / Linux',
  '```bash',
  'chmod +x setup.sh && ./setup.sh',
  '```',
  '',
  'Setup: installs dependencies (axios, bs58, dotenv, express, winston), creates',
  '`backend/.env` from the template, and runs a self-test.',
  '',
  '## Add your API key (ONE is enough)',
  '',
  'Open `backend/.env` and set one key. **Groq is free and fastest** — get a key',
  'at https://console.groq.com (it takes under a minute):',
  '',
  '```env',
  'GROQ_API_KEY=your-key-here',
  '```',
  '',
  'Alternates (all have free tiers): `GEMINI_API_KEY`, `OPENROUTER_API_KEY`,',
  '`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`. The server tries them in order.',
  '',
  '## Connect to Claude',
  '',
  '### Claude Desktop',
  '',
  'Edit the Claude Desktop config — File ▸ Settings ▸ Developer ▸ Edit Config,',
  'and add this to `claude_desktop_config.json` (use the **full path** to your',
  '`mcp-server-rag.js`):',
  '',
  '```json',
  '{"mcpServers":{"shaddai":{"command":"node","args":["C:\\path\\to\\shaddai-mcp\\backend\\mcp-server-rag.js"]}}}',
  '```',
  '',
  '### Claude Code (CLI)',
  '',
  '```bash',
  'claude mcp add shaddai -- node /full/path/to/shaddai-mcp/backend/mcp-server-rag.js',
  '```',
  '',
  '### Cursor',
  '',
  'Settings ▸ Features ▸ MCP ▸ Add new MCP server ▸ type `stdio` and set the',
  'same `node <full path>/backend/mcp-server-rag.js` command.',
  '',
  '## Try it',
  '',
  'In any Claude chat, ask things like:',
  '',
  '- "`list_agents` — which agents are available?"',
  '- "`rag_search` in NEXUS\'s KB for how to design a scalable system."',
  '- "`rag_ask` — using the ORACLE knowledge base, what is manifestation?"',
  '- "`run_agent` — QUILL, write a stoic essay on discipline using your knowledge base."',
  '',
  '## Troubleshooting',
  '',
  '- **`--self-test`** — `node backend/mcp-server-rag.js --self-test` (fast, no model)',
  '  or `--self-test-full` (also exercises rag_ask + run_agent, slow).',
  '- **No output in Claude** — the MCP server logs to **stderr**; stdout is reserved',
  '  for the protocol. Run it from a terminal and watch stderr.',
  '- **`run_agent` needs a key** — cloud-first means it wants a `.env` API key.',
  '- **MCP tools for the agents** — `backend/data/mcp-servers.json` lists optional',
  '  external MCP servers (filesystem / fetch / memory) the agents can use.',
  '',
].join('\n'));

// ── 14. .gitignore ─────────────────────────────────────────────────────────────
fs.writeFileSync(path.join(DIST, '.gitignore'), [
  'node_modules/',
  'backend/.env',
  'generated-output/',
  'backend/execution-logs/',
  '*.zip',
].join('\n'));

// ── 15. Zip it ─────────────────────────────────────────────────────────────────
if (fs.existsSync(ZIP)) fs.rmSync(ZIP, { force: true });
try {
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${DIST}' -DestinationPath '${ZIP}' -Force"`, { stdio: 'inherit' });
} catch {
  // fallback: keep the folder unzipped (still shareable), warn loudly
  console.log('[zip] Compress-Archive failed — leaving the folder. Zip manually:');
  console.log(`       Compress-Archive -Path "${DIST}" -DestinationPath "${ZIP}"`);
}

// ── 16. Report ─────────────────────────────────────────────────────────────────
function sizeMB(p) { return (fs.statSync(p).size / 1048576).toFixed(2); }
console.log('── SHADDAI MCP package built ───────────────────────────────────');
console.log(`files in closure : ${copied.length}`);
console.log(`rag docs shipped : ${kbFiles} (${(kbChars / 1048576).toFixed(2)} MB of text)`);
console.log(`dist folder      : ${DIST}  (${sizeMB(DIST) === '0.00' ? '?' : ''} )`);
if (fs.existsSync(ZIP)) console.log(`zip              : ${ZIP}  (${sizeMB(ZIP)} MB)`);
console.log('─────────────────────────────────────────────────────────────────');
