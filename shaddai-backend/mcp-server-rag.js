#!/usr/bin/env node
/**
 * mcp-server-rag.js — SHADDAI RAG + Agents MCP server (stdio)
 *
 * Exposes the SHADDAI agent council and its RAG knowledge base (the
 * YouTube-transcription mastery stores: kb_<agent>) to any MCP stdio client
 * (Claude Desktop, Claude Code, cursor, etc.).
 *
 * Tools:
 *   list_agents      → the 7 agents, their role, KB doc count, tool count
 *   list_rag_docs    → documents inside one agent's knowledge base
 *   rag_search       → raw TF-IDF chunk hits (score + source doc) for a query
 *   rag_ask          → grounded answer synthesized from the KB via local Ollama
 *   run_agent        → full SHADDAI agent run (RAG-injected + skills + MCP tools)
 *
 * Resources:
 *   kb://<agent>     → an agent's knowledge-base document list (browsable)
 *
 * Progress: tools/call may pass _meta.progressToken; long-running tools
 * (rag_ask, run_agent) then emit notifications/progress as they work.
 *
 * Protocol: MCP 2024-11-05 over newline-delimited JSON-RPC 2.0 on stdio.
 * stdout is RESERVED for JSON-RPC — all engine logs are redirected to stderr.
 *
 * CLI:
 *   node mcp-server-rag.js                run as stdio MCP server
 *   node mcp-server-rag.js --self-test    spawn self, run handshake + fast tools
 *   node mcp-server-rag.js --self-test-full   ... plus rag_ask + run_agent (slow)
 *   node mcp-server-rag.js --help         show usage
 *   node mcp-server-rag.js --version      show version
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const VERSION = '2.2.0';

// ── Logging ────────────────────────────────────────────────────────────────────
// stdout must carry ONLY protocol frames. The agent engine and its module graph
// console.log() at startup; redirect ALL of it to stderr so the stream stays pure.
const origLog = console.log, origWarn = console.warn, origError = console.error;
console.log   = (...a) => process.stderr.write(a.map(String).join(' ') + '\n');
console.warn  = (...a) => process.stderr.write('[warn] '  + a.map(String).join(' ') + '\n');
console.error = (...a) => process.stderr.write('[error] ' + a.map(String).join(' ') + '\n');

// Load backend/.env so GROQ_API_KEY, DEFAULT_OLLAMA_MODEL, etc. are honored.
try { require('dotenv').config({ path: path.join(__dirname, '.env') }); } catch {}

// ── Config ─────────────────────────────────────────────────────────────────────
const BACKEND   = __dirname;
const KB_PREFIX = process.env.SHADDAI_RAG_KB_PREFIX || 'kb_';
const MAX_RAG_CHUNKS = 8;

const ragIndex = require('./rag-index');
const knowledge = require('./lib/knowledge');

// The 7 agents are a fixed part of the SHADDAI identity; used for fast arg
// validation WITHOUT loading the heavy engine. list_agents/rag_ask/run_agent
// lazy-load the live registry so tool counts and roles stay accurate.
const STATIC_AGENT_IDS = ['SHADDAI', 'NEXUS', 'ZEROX', 'ORACLE', 'TURTLE', 'QUILL', 'PIKADON'];
const kbOf = (agentId) => KB_PREFIX + String(agentId || 'SHADDAI').toLowerCase();

let _enginePromise = null;
function loadEngine() {
  if (!_enginePromise) {
    _enginePromise = Promise.resolve().then(() => require('./agent-engine'));
  }
  return _enginePromise;
}

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'list_agents',
    description: 'List the 7 SHADDAI agents with their role, goal, knowledge-base document count, and tool count.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_rag_docs',
    description: "List the documents in one agent's RAG knowledge base (the YouTube-transcription mastery store).",
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: STATIC_AGENT_IDS, description: 'Agent id: SHADDAI, NEXUS, ZEROX, ORACLE, TURTLE, QUILL, or PIKADON' },
      },
      required: [],
    },
  },
  {
    name: 'rag_search',
    description: "Search one agent's RAG knowledge base and return raw text chunks ranked by relevance, with scores and source document names.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What to search for' },
        agent: { type: 'string', enum: STATIC_AGENT_IDS, description: 'Agent whose knowledge base to search (default SHADDAI)' },
        limit: { type: 'number', minimum: 1, maximum: MAX_RAG_CHUNKS, description: `Max chunks to return (1-${MAX_RAG_CHUNKS}, default 3)` },
      },
      required: ['query'],
    },
  },
  {
    name: 'rag_ask',
    description: "Answer a question using one agent's full knowledge stack — routes of use, digested/timestamped mastery, curated domain KB, tools ledger, and past learned Q&A (the same 5-layer grounding the dashboard uses) — reasons over it, and returns a grounded answer plus sources. The answer is also stored back into the agent's knowledge base, so the brain keeps growing with use.",
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to answer from the knowledge base' },
        agent: { type: 'string', enum: STATIC_AGENT_IDS, description: 'Agent whose knowledge base to use (default SHADDAI)' },
      },
      required: ['question'],
    },
  },
  {
    name: 'get_route',
    description: "Get an agent's step-by-step playbook for a goal, pulled from the knowledge-routes map (goal → numbered steps citing specific digests). Use when you need HOW to apply the agent's knowledge, not just a synthesized answer.",
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The goal to match against the agent\'s routes (e.g. "price a new offer")' },
        agent: { type: 'string', enum: STATIC_AGENT_IDS, description: 'Agent whose routes to search (default SHADDAI)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_digests',
    description: "List an agent's organized knowledge digests — each a structured breakdown (thesis, timestamped chapters, insights, quotes) of one source, generated by the digestion pipeline. Use to see what organized material exists before asking a question, or to cite a specific source by name.",
    inputSchema: {
      type: 'object',
      properties: {
        agent: { type: 'string', enum: STATIC_AGENT_IDS, description: 'Agent whose digests to list (default SHADDAI)' },
      },
      required: [],
    },
  },
  {
    name: 'run_agent',
    description: 'Run a full SHADDAI agent task: the goal is routed to the right agent, its RAG knowledge + skills are injected, and it uses real tools (including connected MCP tools) to complete the task. Returns the final answer and tools used.',
    inputSchema: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'The task for the agent' },
        agent: { type: 'string', enum: STATIC_AGENT_IDS, description: 'Agent to run. Optional — auto-routed by goal when omitted.' },
        maxIter: { type: 'number', minimum: 1, maximum: 8, description: 'Max agent-loop iterations (default 5)' },
      },
      required: ['goal'],
    },
  },
];

// ── Knowledge helpers ─────────────────────────────────────────────────────────
function kbDocs(agentId) {
  try { return ragIndex.listUserDocs(kbOf(agentId)); } catch { return []; }
}

function kbSearch(agentId, query, limit) {
  try {
    return ragIndex.searchUser(kbOf(agentId), query, Math.max(1, Math.min(MAX_RAG_CHUNKS, limit || 3)));
  } catch { return []; }
}

function normalizeAgent(args) {
  const raw = String(args?.agent || '').toUpperCase().trim();
  return raw || 'SHADDAI';
}

function assertAgent(agentId) {
  if (!STATIC_AGENT_IDS.includes(agentId)) {
    throw new TypeError(`Unknown agent "${agentId}". Valid: ${STATIC_AGENT_IDS.join(', ')}`);
  }
}

// ── Tool execution ────────────────────────────────────────────────────────────
// onProgress(fraction, message) is optional; when set, long-running tools emit
// MCP progress notifications so the client can show live status.
async function runTool(name, args, onProgress) {
  switch (name) {
    case 'list_agents': {
      const { AGENTS } = await loadEngine();
      return STATIC_AGENT_IDS.map(id => {
        const a = AGENTS[id] || {};
        return {
          id,
          role: a.role || null,
          goal: a.goal || null,
          kb_docs: kbDocs(id).length,
          tools: (a.tools || []).length,
        };
      });
    }

    case 'list_rag_docs': {
      const id = normalizeAgent(args);
      assertAgent(id);
      const docs = kbDocs(id);
      return { agent: id, kb: kbOf(id), count: docs.length, docs };
    }

    case 'rag_search': {
      const id = normalizeAgent(args);
      assertAgent(id);
      if (!args?.query || typeof args.query !== 'string') throw new TypeError('"query" (string) is required');
      const hits = kbSearch(id, args.query, args.limit);
      return {
        agent: id, kb: kbOf(id), query: args.query, count: hits.length,
        hits: hits.map(h => ({ doc: h.docName, score: h.score, text: h.chunkText })),
      };
    }

    case 'rag_ask': {
      const id = normalizeAgent(args);
      assertAgent(id);
      if (!args?.question || typeof args.question !== 'string') throw new TypeError('"question" (string) is required');
      if (onProgress) onProgress(0.05, `Grounding in ${id}'s full knowledge stack…`);
      const hits = kbSearch(id, args.question, 4);
      // Full 5-layer grounding (routes, digests, static KB, tools ledger, learned
      // recall) — the same context the dashboard's HTTP API already gets, not
      // just raw chunk search. This was the literal MCP grounding gap.
      const fullContext = knowledge.contextFor(id, args.question);
      if (!hits.length && !fullContext) {
        if (onProgress) onProgress(1, 'No documents found');
        return { agent: id, kb: kbOf(id), answer: 'No documents found in this knowledge base yet — upload transcripts first.', sources: [] };
      }
      const chunkContext = hits.map(h => `[${h.docName}]\n${h.chunkText}`).join('\n\n');
      const context = [fullContext, chunkContext].filter(Boolean).join('\n\n---\n\n');
      const sources = [...new Set(hits.map(h => h.docName))];
      const { AGENTS, modelChat } = await loadEngine();
      const a = AGENTS[id] || {};
      // IMPORTANT: the knowledge context lives in the SYSTEM message, and the
      // user message stays JUST the bare question. Every LLM call routes through
      // AURA's forCall() (agent-engine.js), which runs deterministic pattern
      // solvers (word-count, stats, date-math, etc.) against the *last user
      // message* before ever calling a model — verified via an isolated A/B
      // test that reducing/changing the knowledge blob didn't help, but this
      // message-shape change did. A short bare question can't accidentally
      // match those solvers; a multi-KB-chunk blob full of numbers (timestamps,
      // word counts, durations) reliably could and did (observed: a real
      // question came back as the answer "25", sourced from a stray number in
      // the injected context, not from the model at all).
      const systemPrompt = `You are ${id}, ${a.role || 'a SHADDAI agent'}. Ground every claim in the knowledge below — routes, digests, domain KB, and chunk excerpts. Cite the specific source (doc name, digest, or route title) for each claim. If nothing here answers it, say so plainly rather than inventing detail.\n\nKnowledge:\n${context}`;
      if (onProgress) onProgress(0.4, 'Reasoning over grounded knowledge (cloud chain, no local model needed)…');
      let answer;
      try {
        const r = await modelChat(
          [{ role: 'system', content: systemPrompt }, { role: 'user', content: args.question }],
          id,
          { plainChat: true }
        );
        answer = typeof r === 'string' ? r : (r.content || String(r));
      } catch (e) {
        if (onProgress) onProgress(1, 'Reasoning failed');
        return {
          agent: id, kb: kbOf(id),
          answer: 'No LLM available to synthesize an answer (no API key configured and no local Ollama). Returning the raw matched chunks instead.',
          sources,
          error: String((e && e.message) || e),
          raw: hits.map(h => ({ doc: h.docName, text: h.chunkText })),
        };
      }
      // Evolving brain: store this Q→A back into the agent's KB (best-effort,
      // never throws) so future questions can recall it as learned knowledge.
      knowledge.learn(id, args.question, answer);
      if (onProgress) onProgress(1, 'Answer ready');
      return { agent: id, kb: kbOf(id), answer, sources, grounded: !!fullContext };
    }

    case 'get_route': {
      const id = normalizeAgent(args);
      assertAgent(id);
      if (!args?.query || typeof args.query !== 'string') throw new TypeError('"query" (string) is required');
      const route = knowledge.matchRoute(id, args.query);
      if (!route) return { agent: id, query: args.query, found: false, route: null };
      return {
        agent: id, query: args.query, found: true,
        route: {
          title: route.title,
          match: route.match || [],
          playbook: route.playbook || [],
          sources: route.sources || [],
          amplify: route.amplify || [],
        },
      };
    }

    case 'list_digests': {
      const id = normalizeAgent(args);
      assertAgent(id);
      const file = path.join(__dirname, 'data', 'rag', kbOf(id), 'digests.json');
      if (!fs.existsSync(file)) return { agent: id, count: 0, digests: [] };
      let raw = [];
      try { raw = (JSON.parse(fs.readFileSync(file, 'utf8')).digests || []); } catch { raw = []; }
      const digests = raw.map(d => ({
        name: d.name,
        title: d.title,
        thesis: String(d.thesis || '').slice(0, 240),
        chapters: (d.chapters || []).length,
        insights: (d.chapters || []).reduce((n, c) => n + ((c.insights || []).length), 0),
        quotes: (d.quotes || []).length,
        tsMode: d.tsMode,
      }));
      return { agent: id, count: digests.length, digests };
    }

    case 'run_agent': {
      if (!args?.goal || typeof args.goal !== 'string') throw new TypeError('"goal" (string) is required');
      if (onProgress) onProgress(0.02, 'Loading agent engine…');
      const engine = await loadEngine();
      const agentId = normalizeAgent(args);
      const opts = { user: 'mcp-claude', source: 'mcp-rag-bridge' };
      if (args.maxIter) opts.maxIter = args.maxIter;
      const task = engine.createTask(args.goal, agentId === 'SHADDAI' ? undefined : agentId, opts);

      // Live progress via the engine's event bus (tool-start / tool-done / llm / done).
      const bus = require('./agent-event-bus');
      const onEvent = (ev) => {
        if (!onProgress) return;
        switch (ev.type) {
          case 'llm-start':  onProgress(0.15, `Reasoning (${ev.provider})…`); break;
          case 'tool-start': onProgress(0.3, `Running tool: ${ev.tool}…`); break;
          case 'tool-done':  onProgress(0.5, `Tool ${ev.tool} done (${ev.durationMs}ms)`); break;
          case 'tool-error': onProgress(0.5, `Tool ${ev.tool} error: ${ev.error}`); break;
          case 'done':       onProgress(0.95, 'Finalizing answer…'); break;
          case 'error':      onProgress(1, `Failed: ${ev.error}`); break;
        }
      };
      bus.on(`task:${task.id}`, onEvent);
      try {
        await engine.runAgentLoop(task.id);
      } finally {
        bus.off(`task:${task.id}`, onEvent);
      }
      const done = engine.getTask(task.id) || task;
      if (onProgress) onProgress(1, 'Task complete');
      return {
        taskId: task.id,
        agent: done.agentName,
        status: done.status,
        result: done.result,
        tools_used: done.tools_used || [],
        error: done.error || null,
      };
    }

    default:
      throw new Error('Unknown tool: ' + name);
  }
}

// ── Resource helpers (browse KB as resources) ────────────────────────────────
function listResources() {
  return STATIC_AGENT_IDS.map(id => ({
    uri: `kb://${id.toLowerCase()}`,
    name: `${id} Knowledge Base`,
    description: `Documents in the ${id} RAG mastery store (YouTube-transcription KB)`,
    mimeType: 'application/json',
  }));
}

function readResource(uri) {
  const m = /^kb:\/\/([a-z0-9_-]+)$/i.exec(String(uri || ''));
  if (!m) throw new Error(`Unknown resource uri: ${uri}`);
  const id = m[1].toUpperCase();
  assertAgent(id);
  const docs = kbDocs(id);
  return {
    uri,
    mimeType: 'application/json',
    text: JSON.stringify({ agent: id, kb: kbOf(id), count: docs.length, docs }, null, 2),
  };
}

// ── Protocol machinery ────────────────────────────────────────────────────────
class ShaddaiMCP {
  constructor() {
    this.buffer = '';
    this.initialized = false;
    this.writeFrame = (frame) => process.stdout.write(JSON.stringify(frame) + '\n');
    this.writeFrameRef = this.writeFrame; // stable ref for async callbacks
  }

  // Returns { jsonrpc, id, ... } reply frame, or a Promise<frame>, or null for notifications.
  dispatch(msg) {
    const { id, method, params } = msg || {};
    const hasId = id !== undefined && id !== null;

    if (method === 'initialize') {
      this.initialized = true;
      return {
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: false }, resources: { subscribe: false } },
          serverInfo: { name: 'shaddai-rag', version: VERSION },
          instructions: [
            'The SHADDAI agents are: ' + STATIC_AGENT_IDS.join(', ') + '.',
            'Use rag_search / rag_ask to ground answers in the SHADDAI mastery knowledge base.',
            'Use run_agent to have an agent execute a real task with live tools.',
            'Browse each agent\'s KB via the kb:// resources.',
          ].join(' '),
        },
      };
    }

    if (method === 'notifications/initialized' || method === 'notifications/cancelled') return null;

    if (method === 'ping') return { jsonrpc: '2.0', id, result: {} };

    if (method === 'tools/list') {
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params || {};
      if (!name) return this.error(id, -32602, 'Missing tool name');
      // If the client asked for progress (_meta.progressToken), emit notifications/progress.
      const token = params?._meta?.progressToken;
      const onProgress = token !== undefined
        ? (fraction, message) => this.emitProgress(token, fraction, message)
        : null;
      let p;
      try { p = Promise.resolve(runTool(name, args, onProgress)); }
      catch (e) { p = Promise.reject(e); }
      return p
        .then(result => ({
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false },
        }))
        .catch(err => ({
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true },
        }));
    }

    if (method === 'resources/list') {
      return { jsonrpc: '2.0', id, result: { resources: listResources() } };
    }

    if (method === 'resources/read') {
      try {
        const r = readResource(params?.uri);
        return { jsonrpc: '2.0', id, result: { contents: [r] } };
      } catch (e) {
        return this.error(id, -32602, e.message);
      }
    }

    return this.error(hasId ? id : null, -32601, `Method not found: ${method}`);
  }

  error(id, code, message) {
    return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
  }

  // MCP 2024-11-05 progress notification: no id, fired mid-tool-call.
  emitProgress(token, fraction, message) {
    const frame = {
      jsonrpc: '2.0',
      method: 'notifications/progress',
      params: { progressToken: token, progress: Math.max(0, Math.min(1, fraction)), message },
    };
    this.writeFrame(frame);
  }

  handleLine(line) {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); }
    catch (e) {
      process.stderr.write(`[mcp] dropping non-JSON line: ${line.slice(0, 120)}\n`);
      return;
    }
    if (!msg || msg.jsonrpc !== '2.0') return;

    const reply = this.dispatch(msg);
    if (!reply) return; // notification → no reply
    if (reply && typeof reply.then === 'function') {
      reply.then(f => { if (f) this.writeFrame(f); })
           .catch(() => { /* already surfaced in .catch path */ });
    } else {
      this.writeFrame(reply);
    }
  }

  feed(chunk) {
    this.buffer += chunk;
    let nl;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl).trim();
      this.buffer = this.buffer.slice(nl + 1);
      this.handleLine(line);
    }
  }
}

function startServer() {
  const server = new ShaddaiMCP();

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => server.feed(chunk));
  process.stdin.on('end', () => { process.exit(0); });
  process.stdin.on('error', () => { /* client closed stdin */ });

  process.stdout.on('error', (e) => {
    if (e.code === 'EPIPE') process.exit(0); // client closed
  });

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

// ── CLI / self-test ───────────────────────────────────────────────────────────
function usage() {
  return `SHADDAI RAG + Agents MCP server v${VERSION}

Usage:
  node mcp-server-rag.js                 run as stdio MCP server (default)
  node mcp-server-rag.js --self-test     spawn self; handshake + fast tools (list_agents, rag_search, list_rag_docs, resources)
  node mcp-server-rag.js --self-test-full   also run rag_ask + run_agent (slow: local Ollama / agent loop)
  node mcp-server-rag.js --help          show this help
  node mcp-server-rag.js --version       show version

Env:
  GROQ_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY
                 cloud LLM chain for rag_ask + run_agent (any one is enough; groq is fastest)
  DEFAULT_OLLAMA_MODEL  optional local fallback model (default: phi4-mini:latest)
  OLLAMA_API_URL        Ollama base URL (default: http://localhost:11434)
  OLLAMA_TIMEOUT_MS     Ollama timeout in ms (default: 300000)
  SHADDAI_RAG_KB_PREFIX prefix for agent KB names (default: kb_)

  No Ollama required: rag_ask and run_agent use the cloud chain first and only
  fall back to a local model if no API key is configured.
`;
}

async function selfTest(full) {
  const script = __filename;
  const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const frames = [];
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (c) => {
    buf += c;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let f; try { f = JSON.parse(line); } catch { continue; }
      frames.push(f);
      if (f.id !== undefined && pending.has(f.id)) { pending.get(f.id)(f); pending.delete(f.id); }
    }
  });

  const send = (o) => child.stdin.write(JSON.stringify(o) + '\n');
  const wait = (id, ms = 30000) => new Promise((res, rej) => {
    pending.set(id, res);
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); rej(new Error(`timeout waiting for id ${id}`)); } }, ms);
  });

  let pass = 0, fail = 0;
  const ok = (name, cond, extra) => {
    if (cond) { pass++; console.log(`  [PASS] ${name}`); }
    else { fail++; console.log(`  [FAIL] ${name}${extra ? ' — ' + extra : ''}`); }
  };

  try {
    // initialize
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'self-test', version: '1' } } });
    const init = await wait(1);
    ok('initialize', init.result?.serverInfo?.name === 'shaddai-rag', JSON.stringify(init.error || init.result));

    // tools/list
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const tl = await wait(2);
    const names = (tl.result?.tools || []).map(t => t.name);
    ok('tools/list has 7 tools', names.length === 7, names.join(','));
    ['list_agents', 'list_rag_docs', 'rag_search', 'rag_ask', 'get_route', 'list_digests', 'run_agent'].forEach(n => ok(`  has ${n}`, names.includes(n)));

    // resources/list
    send({ jsonrpc: '2.0', id: 3, method: 'resources/list', params: {} });
    const rl = await wait(3);
    ok('resources/list returns 7 KB resources', (rl.result?.resources || []).length === 7);

    // ping
    send({ jsonrpc: '2.0', id: 4, method: 'ping', params: {} });
    const pg = await wait(4);
    ok('ping', pg.result !== undefined);

    // list_agents
    send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'list_agents', arguments: {} } });
    const la = await wait(5, 60000);
    const laData = JSON.parse(la.result?.content?.[0]?.text || '{}');
    ok('list_agents returns 7 agents', Array.isArray(laData) && laData.length === 7, JSON.stringify(la.error));

    // rag_search (NEXUS KB)
    send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'rag_search', arguments: { query: 'langgraph agent memory', agent: 'NEXUS', limit: 2 } } });
    const rs = await wait(6);
    const rsData = JSON.parse(rs.result?.content?.[0]?.text || '{}');
    ok('rag_search returns hits', Array.isArray(rsData.hits) && rsData.hits.length > 0, JSON.stringify(rsData).slice(0, 150));

    // list_rag_docs
    send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'list_rag_docs', arguments: { agent: 'NEXUS' } } });
    const ld = await wait(7);
    const ldData = JSON.parse(ld.result?.content?.[0]?.text || '{}');
    ok('list_rag_docs returns docs', ldData.count > 0, JSON.stringify(ldData).slice(0, 150));

    // list_digests
    send({ jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'list_digests', arguments: { agent: 'ZEROX' } } });
    const dg = await wait(20);
    const dgData = JSON.parse(dg.result?.content?.[0]?.text || '{}');
    ok('list_digests returns digests', dgData.count > 0, JSON.stringify(dgData).slice(0, 150));

    // get_route
    send({ jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'get_route', arguments: { query: 'price a new offer', agent: 'ZEROX' } } });
    const rt = await wait(21);
    const rtData = JSON.parse(rt.result?.content?.[0]?.text || '{}');
    ok('get_route responds (found or not)', typeof rtData.found === 'boolean', JSON.stringify(rtData).slice(0, 150));

    // unknown tool → clean error, not a crash
    send({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'not_a_tool', arguments: {} } });
    const ut = await wait(8);
    ok('unknown tool returns isError', ut.result?.isError === true);

    // method not found
    send({ jsonrpc: '2.0', id: 9, method: 'bogus/method', params: {} });
    const mf = await wait(9);
    ok('unknown method returns -32601', mf.error?.code === -32601);

    // invalid arg type → -32602
    send({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'rag_search', arguments: { agent: 'NEXUS' } } });
    const ia = await wait(10);
    ok('missing required arg → error', ia.result?.isError === true, JSON.stringify(ia).slice(0, 120));

    if (full) {
      // rag_ask (slow, local Ollama) — request progress via _meta.progressToken
      console.log('  …running rag_ask (local Ollama)…');
      send({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'rag_ask', arguments: { question: 'What are the three components of an AI agent?', agent: 'NEXUS' }, _meta: { progressToken: 'pt-11' } } });
      const ra = await wait(11, 360000);
      const raData = JSON.parse(ra.result?.content?.[0]?.text || '{}');
      ok('rag_ask returns grounded answer', typeof raData.answer === 'string' && raData.answer.length > 20, JSON.stringify(raData).slice(0, 150));
      const progRa = frames.filter(f => f.method === 'notifications/progress' && f.params?.progressToken === 'pt-11');
      ok('rag_ask emits progress notifications', progRa.length >= 2, `got ${progRa.length}`);

      // run_agent (slow)
      console.log('  …running run_agent (full loop)…');
      send({ jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'run_agent', arguments: { goal: 'Briefly explain the three components of an AI agent.', agent: 'NEXUS' }, _meta: { progressToken: 'pt-12' } } });
      const rn = await wait(12, 600000);
      const rnData = JSON.parse(rn.result?.content?.[0]?.text || '{}');
      ok('run_agent completes', rnData.status === 'completed' && typeof rnData.result === 'string', JSON.stringify(rnData).slice(0, 150));
      const progRn = frames.filter(f => f.method === 'notifications/progress' && f.params?.progressToken === 'pt-12');
      ok('run_agent emits progress notifications', progRn.length >= 2, `got ${progRn.length}`);
    }
  } catch (e) {
    fail++;
    console.log(`  [FAIL] harness error: ${e.message}`);
  } finally {
    child.kill();
    child.stderr.on('data', (c) => process.stderr.write(c)); // surface engine logs on failure
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

// Reusable by other in-process callers (e.g. federation-routes.js's remote/HTTP
// MCP door) WITHOUT spawning the stdio server or touching process.stdin — the
// CLI dispatch below only runs when this file is executed directly.
module.exports = { runTool, listResources, readResource };

if (require.main === module) {
  const arg = process.argv[2];
  if (arg === '--help' || arg === '-h') { console.log(usage()); process.exit(0); }
  if (arg === '--version' || arg === '-v') { console.log(VERSION); process.exit(0); }
  if (arg === '--self-test' || arg === '--self-test-full') {
    const full = arg === '--self-test-full';
    console.log(`SHADDAI RAG MCP self-test (${full ? 'full' : 'fast'})…`);
    selfTest(full);
  } else if (arg !== undefined) {
    console.error(usage());
    process.exit(1);
  } else {
    startServer();
  }
}
