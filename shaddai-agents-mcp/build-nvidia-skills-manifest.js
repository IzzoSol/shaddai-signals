#!/usr/bin/env node
// ============================================================
// build-nvidia-skills-manifest.js
// Generates nvidia-skills.json for the SHADDAI Agents MCP by reading
// the real SKILL.md frontmatter of every curated NVIDIA skill.
// Source of truth: ~/.agents/skills (canonical install location).
// ASCII-only output. Zero dependencies.
//
// This manifest is the SINGLE SOURCE OF TRUTH for the NVIDIA skills
// catalog. The copy in shaddai-mcp-repo is generated from this one so
// the two MCP servers can never disagree about ids, categories or
// GPU requirements.
// ============================================================
const fs = require('fs');
const path = require('path');
const os = require('os');

const SKILLS_DIR = path.join(os.homedir(), '.agents', 'skills');
const OUT = path.join(__dirname, 'nvidia-skills.json');

// ------------------------------------------------------------
// Categories. Prefix-based and deterministic: a skill's id decides
// its category, so the catalog can never drift between servers.
// ------------------------------------------------------------
const CATEGORY = {
  'data-designer': 'data',
  'nvidia-skill-finder': 'meta',
  'skill-card-generator': 'meta',
  'g-assist-mcp-skill': 'meta',
};

// ------------------------------------------------------------
// requiresGpu = TRUE only when the skill's stated EXECUTION PATH
// cannot complete its purpose without an NVIDIA GPU.
//
// Not GPU: wrappers you author, data you fetch, schemas you validate,
// metrics you compute over annotation files, and router/reference docs.
// Those all run on this Intel HD 620 ThinkPad today.
//
// Each entry carries the reason so the flag is auditable rather than
// a bare assertion.
// ------------------------------------------------------------
const GPU = {
  'paidf-cosmos-predict': 'Runs Cosmos Predict video generation for DEFT media samples.',
  'physical-ai-defect-image-generation': 'Fine-tunes and runs Cosmos AnomalyGen for synthetic defect images.',
  'physical-ai-infrastructure-setup-and-resilient-scaling': 'Deploys and scales GPU inference fleets (MicroK8s / AKS, NIM Operator, OSMO).',
  'physical-ai-neural-reconstruction': 'Neural reconstruction and 3DGS training/rendering are CUDA-only.',
  'physical-ai-video-data-augmentation': 'Runs video augmentation and VLM auto-labelling models.',
  'earth2studio-create-diagnostic': 'Generative and diffusion Earth2Studio diagnostics need a CUDA device.',
  'earth2studio-create-prognostic': 'Time-stepping climate forecast models run on GPU.',
  'earth2studio-deterministic-forecast': 'Executes Earth2Studio model inference for the forecast.',
  'rag-blueprint': 'Deploys NIM / vLLM microservices for the RAG stack.',
  'rag-perf': 'Load-tests a deployed, GPU-backed RAG Blueprint server.',
  'foundationpose-setup': 'Builds FoundationStereo TensorRT engines on CUDA.',
  'foundationpose-pipeline': 'Runs the FoundationPose CUDA perception pipeline.',
  'tao-setup-nvidia-gpu-host': 'Only meaningful on a host with an NVIDIA GPU and CUDA runtime.',
  'tao-run-automl': 'Runs AutoML hyperparameter search over TAO training jobs.',
  'tao-run-automl-deft-pipeline': 'Runs TAO training in the DEFT improvement loop.',
  'tao-run-deft-aoi': 'Runs TAO ChangeNet training in the AOI loop.',
  'tao-run-deft-aoi-cosmos3': 'Runs Cosmos Framework LoRA supervised fine-tuning.',
  'tao-run-deft-object-detection': 'Runs TAO Grounding DINO training.',
  'tao-run-deft-od-aoi': 'Runs TAO RT-DETR training.',
  'tao-mine-aoi-images': 'Computes SigLIP embeddings before nearest-neighbour mining.',
  'tao-generate-anomalies': 'Runs AnomalyGen synthetic generation.',
  'tao-generate-image-embeddings': 'Computes CLIP / SigLIP embeddings on the GPU.',
  'tao-generate-referring-expressions': 'Runs VLM distillation for referring expressions.',
  'tao-run-inference-service': 'Starts a TensorRT inference microservice.',
  'g-assist-mcp-skill': 'Reads and changes NVIDIA display and GPU settings.',
};

const SAP = {
  'data-designer': 'Designs the SAP synthetic + reference dataset schema for forest growth, carbon and plot records used by the EduTwin.',
  'omniverse-cad-to-simready': 'Converts CAD/plot geometry into simulation-ready USD stages so a physical site becomes a narrated 3D twin.',
  'omniverse-content-services': 'USD content collaboration and versioning for the physical-AI asset pipeline; how SAP plots move between scenes and agents.',
  'omniverse-realtime-viewer': 'Runtime viewer routing for the live 3D forest twin; reference for performant interactive playback.',
  'omniverse-usd-performance-tuning': 'Diagnoses slow-loading/high-memory USD stages; keeps the EduTwin twin smooth on an 8GB machine.',
  'paidf-cosmos-predict': 'Generates Cosmos physical-AI video narration frames for the forest growth storyboard.',
  'physical-ai-defect-image-generation': 'Synthetic data generation discipline (Day 0 / Day 1) transferable to augmenting degraded forest imagery.',
  'physical-ai-infrastructure-setup-and-resilient-scaling': 'Scaling and resilience playbook for synthetic-data generation fleets; relevant to a future SAP compute tier.',
  'physical-ai-neural-reconstruction': 'Neural reconstruction of physical environments; route for turning field imagery into a scene.',
  'physical-ai-physics-selection': 'Physics engine selection for the EduTwin; why a calibrated statistical model beats a heavy simulator on 8GB.',
  'physical-ai-video-data-augmentation': 'Video augmentation and auto-labelling for narration clips of tree growth over time.',
  'earth2studio-install': 'Install and environment setup for NVIDIA Earth2Studio climate AI; sets up the carbon/forest weather layer.',
  'earth2studio-discover': 'Find the right Earth2Studio climate model and data source for a forest carbon use case.',
  'earth2studio-create-datasource': 'Build climate data source wrappers feeding the carbon model (temperature, rainfall, drought).',
  'earth2studio-create-diagnostic': 'Build derived climate diagnostics (e.g. heat/drought indices) that explain canopy stress in the twin.',
  'earth2studio-create-prognostic': 'Build time-stepping climate forecast models for multi-year canopy projection.',
  'earth2studio-data-fetch': 'Fetch live weather/climate series for plot locations to drive the tree growth model.',
  'earth2studio-deterministic-forecast': 'Deterministic multi-year climate forecast scripts that make the 15-year carbon projection reproducible.',
  'rag-blueprint': 'Deploy/configure an NVIDIA RAG Blueprint service; overlaps the existing SHADDAI RAG brain MCP.',
  'rag-eval': 'RAG quality benchmarking (RAGAS) for the SHADDAI RAG brain and the Asimov knowledge corpus.',
  'rag-perf': 'Latency and throughput profiling for a deployed RAG service on constrained hardware.',
  'foundationpose-setup': 'Install and repair the 6D perception pipeline; reference for camera pose estimation on physical sites.',
  'foundationpose-pipeline': 'Perception pipeline for measuring real trees/plots: depth, pose, re-scoring against the twin.',
  'tao-setup': 'One-time TAO session setup and cross-skill discovery map.',
  'tao-list-capabilities': 'Enumerate available TAO models and workflows so an agent can pick the right one.',
  'tao-data-io': 'Moves datasets between storage tiers and compute; the staging pattern for forest imagery training sets.',
  'tao-convert-dataset-format': 'Convert image/detection datasets between formats for canopy and plot labelling.',
  'tao-validate-dataset-format': 'Validate dataset schema and cross-references before any training run.',
  'tao-run-automl': 'Hyperparameter optimisation loop; the pattern used to tune the EduTwin growth parameters.',
  'tao-run-automl-deft-pipeline': 'Three-phase baseline -> improvement loop -> refinement; mirrors tune -> calibrate -> re-verify.',
  'tao-run-deft-aoi': 'Iterative synthetic-data improvement loop with gap analysis; the discipline for weak canopy imagery.',
  'tao-run-deft-aoi-cosmos3': 'Disk-backed Cosmos Reason 3 improvement loop; narrated physical-AI inspection pattern.',
  'tao-run-deft-object-detection': 'Smart data augmentation for object detection; applicable to seedling and plot marker detection.',
  'tao-run-deft-od-aoi': 'Binary inspection loop with KPI gating; pattern for canopy health OK/NG classification.',
  'tao-mine-aoi-images': 'Mine nearest-neighbour real images for augmentation; useful for rare forest species imagery.',
  'tao-generate-anomalies': 'Synthetic anomaly generation pipeline; pattern for degraded/diseased tree imagery.',
  'tao-generate-image-embeddings': 'Embed forest imagery into vectors so similar plots can be matched and compared.',
  'tao-generate-referring-expressions': 'Turn labelled regions into grounded descriptions; pattern for narrating what the twin sees.',
  'tao-run-inference-service': 'Start/stop a containerised inference endpoint; the deployment pattern for a local carbon inference API.',
  'tao-token-efficient-execution': 'Compile skills into stage cards for 67-91% token reduction; direct answer to our 8GB / low-context budget.',
  'tao-artifacts': 'Authoritative JSON schemas for typed job artifacts; the contract format for SAP workflow records.',
  'tao-launch-workflow': 'Mandatory pre-launch gate and execution contract before any side-effecting training or export.',
  'tao-analyze-detection-kpi': 'Per-class precision/recall/AP scoring; the KPI discipline applied to canopy health metrics.',
  'tao-analyze-gaps-od-map': 'Gap analysis to find weak imagery by recall/precision thresholds; finds where the twin is wrong.',
  'tao-setup-nvidia-gpu-host': 'GPU host prerequisites; reference for a future GPU tier (not required on the current Intel HD 620 machine).',
  'nvidia-skill-finder': 'Router that discovers which NVIDIA skill fits a request; entry point for the whole NVIDIA library.',
  'skill-card-generator': 'Generates governance skill cards so each NVIDIA skill has a reviewable, auditable summary.',
  'g-assist-mcp-skill': 'Checks and changes NVIDIA display/GPU settings; only useful once a real NVIDIA GPU is attached.',
};

function ascii(s) {
  return String(s == null ? '' : s)
    .replace(/\uFFFD/g, '')
    .replace(/[\u2014\u2015]/g, ' - ')
    .replace(/[\u2013]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2192/g, '->')
    .replace(/[\u2264\u2265]/g, '<=')
    .replace(/\u00D7/g, 'x')
    .replace(/\u2026/g, '...')
    .replace(/\u00A0/g, ' ')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ------------------------------------------------------------
// YAML-ish frontmatter reader.
//
// Handles the three shapes the upstream NVIDIA skills actually use:
//   key: plain scalar
//   key: plain scalar continued on indented lines
//   key: "quoted scalar" continued on indented lines
//   key: >- / > / | / |-  block scalars
//
// A naive line-based reader truncates the multi-line descriptions,
// so this has to be right: the description is what an agent reads to
// decide whether to open the skill at all.
// ------------------------------------------------------------
function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const lines = m[1].split(/\r?\n/);
  const out = {};
  let key = null, buf = [], openQuote = null;

  const flush = () => {
    if (key) {
      let v = buf.join(' ').replace(/\s+/g, ' ').trim();
      if (openQuote) {
        if (v.endsWith(openQuote)) v = v.slice(0, -1);
      } else if (v.length > 1 && v.startsWith('"') && v.endsWith('"')) {
        v = v.slice(1, -1);
      } else if (v.length > 1 && v.startsWith("'") && v.endsWith("'")) {
        v = v.slice(1, -1);
      }
      out[key] = v.trim();
    }
    key = null; buf = []; openQuote = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\t/g, '  ');
    if (/^\s/.test(line)) {                 // continuation of the current key
      if (key) {
        const t = line.trim();
        if (t) buf.push(t);
      }
      continue;
    }
    const top = /^([A-Za-z0-9_.\-]+)\s*:(.*)$/.exec(line);
    if (!top) continue;
    flush();
    key = top[1];
    const val = top[2].trim();
    if (val === '>-' || val === '>' || val === '|' || val === '|-' || val === '|+') {
      buf = [];
    } else if (val.startsWith('"')) {
      openQuote = '"';
      buf = [val.slice(1)];
    } else if (val.startsWith("'")) {
      openQuote = "'";
      buf = [val.slice(1)];
    } else {
      buf = [val];
    }
  }
  flush();
  return out;
}

function categoryFor(id) {
  if (CATEGORY[id]) return CATEGORY[id];
  if (id.startsWith('omniverse-')) return 'omniverse';
  if (id.startsWith('physical-ai-')) return 'physical-ai';
  if (id.startsWith('earth2studio-')) return 'climate';
  if (id.startsWith('rag-')) return 'rag';
  if (id.startsWith('tao-')) return 'tao';
  if (id.startsWith('foundationpose-')) return 'vision';
  if (id.startsWith('paidf-')) return 'cosmos';
  return 'meta';
}

const IDS = Object.keys(SAP).sort();
const out = [];
for (const id of IDS) {
  const file = path.join(SKILLS_DIR, id, 'SKILL.md');
  const exists = fs.existsSync(file);
  const fm = exists ? parseFrontmatter(fs.readFileSync(file, 'utf8')) : {};
  const entry = {
    id: id,
    name: ascii(fm.name || id),
    version: ascii(fm.version || ''),
    license: ascii(fm.license || ''),
    description: ascii(fm.description || ''),
    category: categoryFor(id),
    source: 'NVIDIA/skills',
    requiresGpu: Object.prototype.hasOwnProperty.call(GPU, id),
    sapRelevance: SAP[id],
    path: '~/.agents/skills/' + id + '/SKILL.md',
    installed: exists,
  };
  if (entry.requiresGpu) entry.gpuReason = GPU[id];
  out.push(entry);
}

out.sort((a, b) => (a.category === b.category ? a.id.localeCompare(b.id) : a.category.localeCompare(b.category)));
const gpuTrue = out.filter(s => s.requiresGpu).length;
const manifest = {
  version: '2.0.0',
  generatedFrom: '~/.agents/skills (canonical NVIDIA/skills install)',
  skillRoot: '~/.agents/skills',
  count: out.length,
  requiresGpuCount: gpuTrue,
  runsWithoutGpuCount: out.length - gpuTrue,
  gpuNote: 'This machine has an Intel HD Graphics 620 and no NVIDIA GPU. Skills flagged requiresGpu=true are installed and usable as documentation and workflow design, but cannot execute their model steps locally until an NVIDIA GPU is attached. Skills flagged false run as-is today: they author wrappers, fetch data, validate schemas, compute metrics over annotation files, or route to another skill.',
  gpuRule: 'requiresGpu=true only when the skill\'s stated execution path cannot complete its purpose without an NVIDIA GPU. Each true entry carries a gpuReason.',
  skills: out,
};
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

const missing = out.filter(s => !s.installed);
const noDesc = out.filter(s => !s.description);
const truncated = out.filter(s => s.description && !/[.!?)]$/.test(s.description));
console.log('wrote ' + OUT);
console.log('skills: ' + out.length + ' | missing SKILL.md: ' + missing.length + ' | empty description: ' + noDesc.length);
if (missing.length) console.log('MISSING: ' + missing.map(s => s.id).join(', '));
if (noDesc.length) console.log('NO DESC: ' + noDesc.map(s => s.id).join(', '));
if (truncated.length) console.log('TRUNCATED: ' + truncated.map(s => s.id).join(', '));
const cats = {};
for (const s of out) cats[s.category] = (cats[s.category] || 0) + 1;
console.log('categories: ' + JSON.stringify(cats));
console.log('requiresGpu true: ' + gpuTrue + ' | false: ' + (out.length - gpuTrue));
const bad = JSON.stringify(manifest).match(/[^\x00-\x7F]/g);
console.log('non-ascii codepoints: ' + (bad ? bad.length : 0));
