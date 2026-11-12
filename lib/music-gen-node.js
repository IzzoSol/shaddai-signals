// backend/lib/music-gen-node.js
// FREE server-side procedural music generation — pure Node, no Web Audio, no keys,
// no external API. Hand-synthesizes 16-bit PCM and returns a WAV Buffer so the
// Telegram bot (or any server surface) can sendAudio a real track. Same musical
// design as public/turtle-music-bot.html (the in-browser studio).
'use strict';

const SR = 44100;

const GENRES = {
  lofi:      { name:'Lo-Fi',     scale:'minPent', prog:[0,3,4,3], bpm:82,  kick:[0,8],      snare:[4,12], hat:2, wave:'sine',     bass:'triangle', swing:.12 },
  synthwave: { name:'Synthwave', scale:'minor',   prog:[0,5,3,4], bpm:100, kick:[0,4,8,12], snare:[4,12], hat:2, wave:'sawtooth', bass:'sawtooth', swing:0   },
  trap:      { name:'Trap',      scale:'minor',   prog:[0,0,5,3], bpm:140, kick:[0,6,10],   snare:[8],    hat:1, wave:'square',   bass:'square',   swing:0   },
  ambient:   { name:'Ambient',   scale:'major',   prog:[0,4,5,4], bpm:68,  kick:[],         snare:[],     hat:0, wave:'sine',     bass:'sine',     swing:0   },
  house:     { name:'House',     scale:'minPent', prog:[0,3,5,4], bpm:124, kick:[0,4,8,12], snare:[4,12], hat:2, wave:'sawtooth', bass:'sawtooth', swing:0   },
  chip:      { name:'8-Bit',     scale:'major',   prog:[0,4,5,3], bpm:132, kick:[0,8],      snare:[4,12], hat:2, wave:'square',   bass:'square',   swing:0   },
};
const MOODS = { chill:{oct:0,lead:.7}, bright:{oct:1,lead:1}, dark:{oct:-1,lead:.8}, dreamy:{oct:0,lead:.55}, hype:{oct:0,lead:1.2} };
const SCALES = { major:[0,2,4,5,7,9,11], minor:[0,2,3,5,7,8,10], minPent:[0,3,5,7,10], dorian:[0,2,3,5,7,9,10] };
const ALIASES = { '8bit':'chip','8-bit':'chip','chiptune':'chip','synth':'synthwave','wave':'synthwave','hiphop':'lofi','lo-fi':'lofi','lofi':'lofi' };

function pickGenre(s){ s=String(s||'').toLowerCase().trim(); return GENRES[s]?s:(ALIASES[s]||null); }
function pickMood(s){ s=String(s||'').toLowerCase().trim(); return MOODS[s]?s:null; }

function wave(type, ph){ // ph = phase in cycles
  const x = ph - Math.floor(ph);
  if (type==='sine')     return Math.sin(2*Math.PI*x);
  if (type==='square')   return x<0.5 ? 1 : -1;
  if (type==='sawtooth') return 2*x-1;
  if (type==='triangle') return 4*Math.abs(x-0.5)-1;
  return Math.sin(2*Math.PI*x);
}
function noteFreq(semi){ return 261.63*Math.pow(2, semi/12); } // C4 base

// Generate → { wav: Buffer, meta }
function generate(opts) {
  opts = opts || {};
  const gk = pickGenre(opts.genre) || 'lofi';
  const g = GENRES[gk];
  const mk = pickMood(opts.mood) || 'chill';
  const mood = MOODS[mk];
  const bpm = Math.max(50, Math.min(180, opts.bpm || g.bpm));
  const bars = Math.max(4, Math.min(16, opts.bars || 8));
  const sc = SCALES[g.scale];

  const spb = 60/bpm, stepDur = spb/4;
  const totalSec = bars*spb*4 + 0.6;
  const N = Math.ceil(totalSec*SR);
  const buf = new Float32Array(N);

  function osc(type, freq, tStart, dur, gain){
    const i0 = Math.max(0, Math.floor(tStart*SR)), i1 = Math.min(N, Math.floor((tStart+dur)*SR));
    for (let i=i0;i<i1;i++){ const tt=(i-i0)/SR;
      const env = Math.min(1, tt/0.010) * Math.exp(-tt/(dur*0.45));
      buf[i] += wave(type, freq*(i/SR)) * gain * env;
    }
  }
  function kick(tStart){
    const dur=0.30, i0=Math.floor(tStart*SR), i1=Math.min(N, Math.floor((tStart+dur)*SR));
    let ph=0;
    for (let i=i0;i<i1;i++){ const tt=(i-i0)/SR;
      const f = 150*Math.pow(45/150, Math.min(1, tt/0.12)); // sweep 150→45
      ph += f/SR; const env=Math.exp(-tt/0.09);
      buf[i] += Math.sin(2*Math.PI*ph) * env;
    }
  }
  function noise(tStart, dur, gain, hp){
    const i0=Math.floor(tStart*SR), i1=Math.min(N, Math.floor((tStart+dur)*SR)); let prev=0;
    for (let i=i0;i<i1;i++){ const tt=(i-i0)/SR; let n=Math.random()*2-1;
      if (hp){ const cur=n; n=n-prev; prev=cur; } // crude high-pass for hats
      buf[i] += n * gain * Math.exp(-tt/(dur*0.5));
    }
  }

  const t0 = 0.05, prog = g.prog, root = -12 + mood.oct*12;
  for (let bar=0; bar<bars; bar++){
    const deg = prog[bar%prog.length];
    const chordRoot = root + sc[deg%sc.length];
    const barT = t0 + bar*spb*4;
    // chords — triad held (skip if ambient wants space? keep, low gain)
    [0,2,4].forEach(function(iv){
      const semi = chordRoot + (sc[(deg+iv)%sc.length]-sc[deg%sc.length]) + 12;
      osc(g.wave, noteFreq(semi), barT, spb*4*0.96, 0.05);
    });
    for (let step=0; step<16; step++){
      const sw = (step%2===1) ? g.swing*stepDur : 0;
      const t = barT + step*stepDur + sw;
      if (g.kick.indexOf(step)>=0) kick(t);
      if (g.snare.indexOf(step)>=0) noise(t, 0.18, 0.5, false);
      if (g.hat && step%g.hat===0) noise(t, 0.03, 0.14, true);
      if (step%4===0) osc(g.bass, noteFreq(chordRoot-12), t, stepDur*3.6, 0.16); // bass on downbeats
      if (step%2===0 && Math.random() < 0.45*mood.lead){ // sparse melody
        const mi = sc[(deg + (Math.floor(Math.random()*sc.length)))%sc.length];
        osc(g.wave, noteFreq(root+mi+12), t, stepDur*1.6, 0.10*mood.lead);
      }
    }
  }

  // soft-clip + normalize
  let peak=0; for (let i=0;i<N;i++){ const a=Math.abs(buf[i]); if(a>peak)peak=a; }
  const norm = peak>0 ? 0.92/peak : 1;
  const wav = encodeWAV(buf, norm);
  return { wav, meta:{ genre:gk, genreName:g.name, mood:mk, bpm, bars, seconds:+totalSec.toFixed(1) } };
}

// Float32 (mono) → 16-bit PCM mono WAV Buffer
function encodeWAV(samples, gain){
  const n = samples.length, dataLen = n*2, buf = Buffer.alloc(44+dataLen);
  buf.write('RIFF',0); buf.writeUInt32LE(36+dataLen,4); buf.write('WAVE',8);
  buf.write('fmt ',12); buf.writeUInt32LE(16,16); buf.writeUInt16LE(1,20); buf.writeUInt16LE(1,22);
  buf.writeUInt32LE(SR,24); buf.writeUInt32LE(SR*2,28); buf.writeUInt16LE(2,32); buf.writeUInt16LE(16,34);
  buf.write('data',36); buf.writeUInt32LE(dataLen,40);
  let p=44;
  for (let i=0;i<n;i++){ let x=samples[i]*gain; x=Math.max(-1,Math.min(1, Math.tanh(x))); buf.writeInt16LE(Math.round(x*32767), p); p+=2; }
  return buf;
}

module.exports = { generate, GENRES, MOODS, pickGenre, pickMood };
