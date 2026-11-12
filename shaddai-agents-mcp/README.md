# SHADDAI Agents MCP

Use your **7 SHADDAI agents** — with their real tools and agentic loop — inside **Claude Code, Cursor, or any MCP client**. Zero dependencies. It proxies to your running SHADDAI backend.

## The agents
| Agent | Specialty |
|---|---|
| **SHADDAI** | Supreme Orchestrator — strategy, coordination |
| **NEXUS** | Technical Architect — runs code (JS/Python), GitHub, security scans |
| **ZEROX** | Wealth & Revenue — live prices, DeFi, trade math |
| **ORACLE** | Research & Intelligence — web/wiki/arxiv/reddit + synthesis |
| **TURTLE** | UI/UX & Creative — images, palettes, diagrams |
| **QUILL** | Writing & Communication — copy, docs, translation, publishing |
| **PIKADON** | Security & Compliance — code audits, security checks |

## Tools it exposes
- `shaddai_list_agents` — list the 7 agents + what they do
- `shaddai_ask` — quick single reply from a chosen agent
- `shaddai_task` — a **real agentic job**: the agent uses its tools over multiple steps and returns the finished work
- `nvidia_skills` — the curated **NVIDIA/skills** library (48 entries): the whole catalog, or one skill's full `SKILL.md` body

## The NVIDIA skills library

A curated 48-skill slice of [NVIDIA/skills](https://github.com/NVIDIA/skills), installed locally and exposed as a tool.

| Category | Count | What it covers |
|----------|-------|----------------|
| `tao` | 22 | TAO data services, AutoML, DEFT loops, dataset formats |
| `climate` | 7 | Earth2Studio deterministic forecasts and diagnostics |
| `physical-ai` | 5 | Defect generation, video augmentation, infrastructure |
| `omniverse` | 4 | USD/SimReady/CAD-to-SimReady workflows |
| `meta` | 3 | Skill discovery and environment setup |
| `rag` | 3 | NVIDIA RAG Blueprint deploy/configure/troubleshoot |
| `vision` | 2 | FoundationPose perception pipeline |
| `cosmos` | 1 | Cosmos AnomalyGen synthetic defect generation |
| `data` | 1 | TAO dataset conversion and validation |

**25 of the 48 require an NVIDIA GPU** to complete their stated execution path; the other 23 run CPU-only. Every GPU-flagged entry carries a `gpuReason` naming the exact step that needs the GPU.

The catalog lives at `~/.agents/skills` by default. Point it elsewhere with `SHADDAI_NVIDIA_SKILLS_ROOT`.

Call it three ways:

- **List all** — `nvidia_skills` with no arguments returns every skill with its id, category, GPU flag and S.A.P. relevance.
- **Read one** — `nvidia_skills` with `skill=<id>` returns that skill's full `SKILL.md` body.
- **Filter** — `nvidia_skills` with `query=<text>` keyword-matches over id, name, description and S.A.P. relevance; `category=<name>` filters by category.

Only skill ids listed in `nvidia-skills.json` can be read, ids are charset-restricted, and the resolved path must sit directly inside the catalog root — path traversal is rejected before any filesystem access.

### Rebuilding the manifest

`nvidia-skills.json` is generated, not hand-edited:

```bash
npm run build:manifest   # rebuild from the local skill catalog
npm run sync:manifest    # copy it to the shaddai-mcp repo
npm test                 # 16-check stdio JSON-RPC harness
```

## Setup
Your SHADDAI backend must be running (double-click `START-SHADDAI.bat` → serves `http://localhost:3000`).

**Claude Code:**
```
claude mcp add shaddai -- node "C:/Users/Brittany/mcp-servers/shaddai-agents/mcp.js"
```
**Claude Desktop / Cursor** (`claude_desktop_config.json` / `.cursor/mcp.json`):
```json
{ "mcpServers": { "shaddai": { "command": "node", "args": ["C:/Users/Brittany/mcp-servers/shaddai-agents/mcp.js"], "env": { "SHADDAI_URL": "http://localhost:3000" } } } }
```

`SHADDAI_URL` defaults to `http://localhost:3000`; set it if you host SHADDAI elsewhere.

## Security
- stdout carries only JSON-RPC (logs go to stderr). Inputs are length-capped. It only talks to the backend URL you configure. MIT licensed.
