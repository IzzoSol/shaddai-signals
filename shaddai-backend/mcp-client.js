/**
 * SHADDAI MCP Client — connect agents to Model Context Protocol servers.
 *
 * Self-contained: implements the MCP JSON-RPC 2.0 client directly (no SDK dep),
 * supporting two transports:
 *   - "stdio": spawn a local MCP server process, exchange newline-delimited JSON-RPC
 *   - "http":  POST JSON-RPC to a Streamable-HTTP MCP endpoint (JSON or SSE response)
 *
 * Servers are LAZY: nothing connects at boot. A server connects on first use
 * (or explicit /api/mcp/connect), so there's no baseline RAM/process cost.
 *
 * On connect we do the MCP handshake (initialize → notifications/initialized →
 * tools/list) and expose each remote tool as `mcp__<server>__<tool>`.
 *
 * Public API:
 *   listServers()                       -> [{id, transport, status, toolCount}]
 *   connect(serverId)                   -> { id, tools: [...] }
 *   disconnect(serverId)                -> bool
 *   listTools(serverId?)                -> [{ name, server, description, inputSchema }]
 *   callTool(prefixedName, args)        -> string (tool result text)
 *   getAgentTools()                     -> { [prefixedName]: { name, description, schema, agents, execute } }
 *   reloadConfig()                      -> server count
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONFIG_PATH = path.join(__dirname, 'data', 'mcp-servers.json');

// In-memory connection state per server id
const conns = new Map(); // id -> { transport, proc?, url?, headers?, nextId, pending:Map, buffer, tools:[], status, sessionId? }

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return Array.isArray(raw) ? raw : (raw.servers || []);
  } catch { return []; }
}

function saveConfig(servers) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify({ servers }, null, 2));
}

function getServerDef(id) {
  return loadConfig().find(s => s.id === id);
}

// ─── stdio transport ──────────────────────────────────────────────────────
function startStdio(def) {
  const conn = {
    transport: 'stdio', nextId: 1, pending: new Map(), buffer: '',
    tools: [], status: 'connecting', proc: null
  };
  const env = { ...process.env, ...(def.env || {}) };
  // shell:true on Windows concatenates args with spaces → a path like "SHADDAI MASTER FINAL BUILD"
  // would split into separate args. Quote any arg containing whitespace so it stays one argument.
  const args = (def.args || []).map(a => /\s/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
  const proc = spawn(def.command, args, { env, stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  conn.proc = proc;
  proc.stdout.on('data', (chunk) => {
    conn.buffer += chunk.toString('utf8');
    let nl;
    while ((nl = conn.buffer.indexOf('\n')) >= 0) {
      const line = conn.buffer.slice(0, nl).trim();
      conn.buffer = conn.buffer.slice(nl + 1);
      if (!line) continue;
      try { handleMessage(conn, JSON.parse(line)); } catch { /* non-JSON log line from server */ }
    }
  });
  proc.stderr.on('data', () => {}); // servers log to stderr; ignore
  proc.on('exit', () => {
    conn.status = 'disconnected';
    for (const { reject } of conn.pending.values()) reject(new Error('MCP server exited'));
    conn.pending.clear();
  });
  proc.on('error', (e) => { conn.status = 'error'; conn.error = e.message; });
  return conn;
}

function sendStdio(conn, msg) {
  conn.proc.stdin.write(JSON.stringify(msg) + '\n');
}

// ─── http (Streamable HTTP) transport ───────────────────────────────────────
function startHttp(def) {
  return {
    transport: 'http', url: def.url, headers: def.headers || {},
    nextId: 1, pending: new Map(), tools: [], status: 'connecting', sessionId: null
  };
}

async function sendHttp(conn, msg) {
  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    ...conn.headers
  };
  if (conn.sessionId) headers['Mcp-Session-Id'] = conn.sessionId;
  const r = await fetch(conn.url, { method: 'POST', headers, body: JSON.stringify(msg), signal: AbortSignal.timeout(30000) });
  const sid = r.headers.get('mcp-session-id');
  if (sid) conn.sessionId = sid;
  // notifications (no id) get 202 with empty body
  if (msg.id === undefined) return;
  const ct = r.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) {
    // Parse SSE: find the data: line with our response id
    const text = await r.text();
    for (const block of text.split('\n\n')) {
      const dataLine = block.split('\n').find(l => l.startsWith('data:'));
      if (!dataLine) continue;
      try { const j = JSON.parse(dataLine.slice(5).trim()); if (j.id === msg.id) return handleResponse(conn, j); } catch {}
    }
    throw new Error('No matching SSE response');
  } else {
    const j = await r.json();
    return handleResponse(conn, j);
  }
}

// ─── shared message handling ────────────────────────────────────────────────
function handleMessage(conn, msg) {
  if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
    handleResponse(conn, msg);
  }
  // server-initiated requests/notifications are ignored (we're a minimal client)
}

function handleResponse(conn, msg) {
  const p = conn.pending.get(msg.id);
  if (!p) return;
  conn.pending.delete(msg.id);
  if (msg.error) p.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
  else p.resolve(msg.result);
}

function request(conn, method, params, timeoutMs = 30000) {
  const id = conn.nextId++;
  const msg = { jsonrpc: '2.0', id, method, params: params || {} };
  if (conn.transport === 'stdio') {
    return new Promise((resolve, reject) => {
      conn.pending.set(id, { resolve, reject });
      const to = setTimeout(() => { if (conn.pending.delete(id)) reject(new Error(`MCP ${method} timeout`)); }, timeoutMs);
      const orig = conn.pending.get(id);
      if (orig) { const r = orig.resolve, j = orig.reject; conn.pending.set(id, { resolve: v => { clearTimeout(to); r(v); }, reject: e => { clearTimeout(to); j(e); } }); }
      try { sendStdio(conn, msg); } catch (e) { conn.pending.delete(id); reject(e); }
    });
  } else {
    return new Promise((resolve, reject) => {
      conn.pending.set(id, { resolve, reject });
      sendHttp(conn, msg).catch(e => { conn.pending.delete(id); reject(e); });
    });
  }
}

function notify(conn, method, params) {
  const msg = { jsonrpc: '2.0', method, params: params || {} };
  if (conn.transport === 'stdio') sendStdio(conn, msg);
  else sendHttp(conn, msg).catch(() => {});
}

// ─── public API ───────────────────────────────────────────────────────────
async function connect(serverId) {
  const def = getServerDef(serverId);
  if (!def) throw new Error(`Unknown MCP server: ${serverId}`);
  if (def.disabled) throw new Error(`MCP server "${serverId}" is disabled in config`);
  // reuse live connection
  const existing = conns.get(serverId);
  if (existing && existing.status === 'ready') return { id: serverId, tools: existing.tools };

  const conn = def.transport === 'http' ? startHttp(def) : startStdio(def);
  conn.def = def;
  conns.set(serverId, conn);

  // handshake — allow extra time for cold npx/stdio server startup
  await request(conn, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'SHADDAI', version: '79.9' }
  }, 75000);
  notify(conn, 'notifications/initialized');

  const toolsRes = await request(conn, 'tools/list');
  conn.tools = (toolsRes.tools || []).map(t => ({
    name: t.name,
    server: serverId,
    description: t.description || '',
    inputSchema: t.inputSchema || { type: 'object', properties: {} }
  }));
  conn.status = 'ready';
  return { id: serverId, tools: conn.tools };
}

function disconnect(serverId) {
  const conn = conns.get(serverId);
  if (!conn) return false;
  try { if (conn.proc) conn.proc.kill(); } catch {}
  conns.delete(serverId);
  return true;
}

// Connect every enabled server at boot (fire-and-forget, never blocks startup).
// Each server fails independently; failures are recorded in the status map.
async function autoConnectAll(timeoutMs = 75000) {
  const enabled = loadConfig().filter(s => !s.disabled);
  const results = await Promise.allSettled(enabled.map(s => connect(s.id)));
  return results.map((r, i) => ({
    id: enabled[i].id,
    ok: r.status === 'fulfilled',
    tools: r.status === 'fulfilled' ? (r.value.tools || []).length : 0,
    error: r.status === 'rejected' ? String(r.reason && r.reason.message || r.reason) : null
  }));
}

function listServers() {
  const defs = loadConfig();
  return defs.map(d => {
    const c = conns.get(d.id);
    return {
      id: d.id,
      transport: d.transport || 'stdio',
      disabled: !!d.disabled,
      status: c ? c.status : 'idle',
      toolCount: c ? c.tools.length : 0,
      description: d.description || ''
    };
  });
}

function listTools(serverId) {
  const out = [];
  for (const [id, conn] of conns) {
    if (serverId && id !== serverId) continue;
    if (conn.status !== 'ready') continue;
    for (const t of conn.tools) out.push({ ...t, prefixed: `mcp__${id}__${t.name}` });
  }
  return out;
}

async function callTool(prefixedName, args) {
  // mcp__<server>__<tool>
  const m = /^mcp__([^_]+(?:_[^_]+)*?)__(.+)$/.exec(prefixedName);
  let serverId, toolName;
  if (m) { serverId = m[1]; toolName = m[2]; }
  else { throw new Error(`Bad MCP tool name: ${prefixedName} (expected mcp__server__tool)`); }

  let conn = conns.get(serverId);
  if (!conn || conn.status !== 'ready') { await connect(serverId); conn = conns.get(serverId); }

  const res = await request(conn, 'tools/call', { name: toolName, arguments: args || {} });
  // MCP returns { content: [{type:'text', text:'...'}, ...], isError? }
  if (res && Array.isArray(res.content)) {
    const text = res.content.map(c => c.type === 'text' ? c.text : (c.type === 'resource' ? JSON.stringify(c.resource) : `[${c.type}]`)).join('\n');
    return res.isError ? `MCP tool error: ${text}` : text;
  }
  return JSON.stringify(res);
}

// Expose connected MCP tools as SHADDAI agent tools (same shape as engine TOOLS).
// Only returns tools from servers that are currently connected (ready).
function getAgentTools() {
  const out = {};
  for (const t of listTools()) {
    // Convert MCP JSON-schema properties to SHADDAI's flat {key:'type — desc'} schema hint
    const schema = {};
    const props = (t.inputSchema && t.inputSchema.properties) || {};
    for (const [k, v] of Object.entries(props)) {
      schema[k] = `${v.type || 'any'}${v.description ? ' — ' + v.description : ''}`;
    }
    out[t.prefixed] = {
      name: t.prefixed,
      description: `[MCP:${t.server}] ${t.description}`.slice(0, 200),
      schema,
      agents: ['SHADDAI', 'NEXUS', 'ORACLE', 'ZEROX', 'TURTLE', 'QUILL', 'PIKADON'],
      mcp: true,
      execute: async (params) => callTool(t.prefixed, params)
    };
  }
  return out;
}

function reloadConfig() { return loadConfig().length; }

module.exports = {
  listServers, connect, disconnect, listTools, callTool, getAgentTools,
  autoConnectAll, reloadConfig, loadConfig, saveConfig, getServerDef
};
