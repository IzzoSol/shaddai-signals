#!/usr/bin/env node
// Test the shaddai-agents MCP stdio protocol: initialize, tools/list, tools/call
const { spawn } = require('child_process');
const path = require('path');

const server = path.join(__dirname, 'mcp.js');
const p = spawn(process.execPath, [server], { stdio: ['pipe', 'pipe', 'pipe'] });

const responses = [];
let buf = '';
p.stdout.setEncoding('utf8');
p.stdout.on('data', c => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    try { responses.push(JSON.parse(line)); } catch (e) { responses.push({ parseError: line }); }
  }
});

const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');

send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nvidia_skills', arguments: {} } });
send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nvidia_skills', arguments: { skill: 'earth2studio-deterministic-forecast' } } });
send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nvidia_skills', arguments: { category: 'climate' } } });
send({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nvidia_skills', arguments: { query: 'carbon forest' } } });
send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'nvidia_skills', arguments: { skill: '../../../etc/passwd' } } });
send({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'shaddai_list_agents', arguments: {} } });

setTimeout(() => {
  p.stdin.end();
  p.kill();
  const byId = {};
  for (const r of responses) byId[r.id] = r;

  const ok = (label, cond, extra) => console.log((cond ? 'PASS  ' : 'FAIL  ') + label + (extra ? '  ' + extra : ''));

  console.log('--- initialize ---');
  console.log('serverInfo: ' + JSON.stringify(byId[1] && byId[1].result && byId[1].result.serverInfo));
  ok('initialize returns serverInfo', !!(byId[1] && byId[1].result && byId[1].result.serverInfo));

  console.log('\n--- tools/list ---');
  const tools = (byId[2] && byId[2].result && byId[2].result.tools) || [];
  console.log('tools: ' + tools.map(t => t.name).join(', '));
  ok('nvidia_skills advertised', tools.some(t => t.name === 'nvidia_skills'));
  ok('original 3 tools still present', ['shaddai_list_agents', 'shaddai_ask', 'shaddai_task'].every(n => tools.some(t => t.name === n)));

  const txt = (id) => { const c = byId[id] && byId[id].result && byId[id].result.content; return c && c[0] ? c[0].text : ''; };

  console.log('\n--- nvidia_skills (no args) ---');
  try {
    const j = JSON.parse(txt(3));
    console.log('total=' + j.total + ' matched=' + j.matched + ' categories=' + JSON.stringify(j.categories));
    ok('lists 48 skills', j.total === 48 && j.matched === 48);
    ok('gpuNote present', typeof j.gpuNote === 'string' && j.gpuNote.length > 20);
    ok('every skill has id+requiresGpu', j.skills.every(s => s.id && typeof s.requiresGpu === 'boolean'));
  } catch (e) { ok('no-args payload parses as JSON', false, e.message); }

  console.log('\n--- nvidia_skills (skill=...) ---');
  try {
    const j = JSON.parse(txt(4));
    console.log('id=' + j.id + ' category=' + j.category + ' requiresGpu=' + j.requiresGpu);
    console.log('content length=' + (j.content ? j.content.length : 0));
    ok('returns full SKILL.md body', !!(j.content && j.content.length > 400));
    ok('body contains frontmatter', /---/.test(j.content || ''));
    ok('sapRelevance present', !!j.sapRelevance);
  } catch (e) { ok('skill payload parses as JSON', false, e.message); }

  console.log('\n--- nvidia_skills (category=climate) ---');
  try {
    const j = JSON.parse(txt(5));
    console.log('matched=' + j.matched + ' -> ' + j.skills.map(s => s.id).join(', '));
    ok('climate filter returns 7', j.matched === 7);
    ok('all returned are climate', j.skills.every(s => s.category === 'climate'));
  } catch (e) { ok('category payload parses', false, e.message); }

  console.log('\n--- nvidia_skills (query) ---');
  try {
    const j = JSON.parse(txt(6));
    console.log('matched=' + j.matched + ' -> ' + j.skills.map(s => s.id).join(', '));
    ok('query returns >0', j.matched > 0);
  } catch (e) { ok('query payload parses', false, e.message); }

  console.log('\n--- path traversal guard ---');
  const t7 = txt(7);
  const isErr = byId[7] && byId[7].result && byId[7].result.isError;
  ok('traversal attempt rejected', !!isErr, '-> ' + t7.slice(0, 90));
  ok('traversal does not leak file content', t7.indexOf('root:') < 0);

  console.log('\n--- regression: shaddai_list_agents ---');
  try {
    const j = JSON.parse(txt(8));
    ok('still returns 7 agents', j.agents && j.agents.length === 7);
  } catch (e) { ok('list_agents payload parses', false, e.message); }

  console.log('\n--- all responses JSON-RPC valid ---');
  ok('8 responses received', responses.length === 8, 'got ' + responses.length);
  ok('no parse errors', !responses.some(r => r.parseError));
}, 3500);
