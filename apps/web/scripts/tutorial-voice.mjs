#!/usr/bin/env node
/**
 * Generates the guided-tour voice notes with ElevenLabs.
 *
 *   ELEVENLABS_API_KEY=... node apps/web/scripts/tutorial-voice.mjs [--force] [--list-voices]
 *
 * Reads narration from apps/web/src/lib/tour/narration.json and writes
 * apps/web/public/tutorial/{glasses,console}/<step>.mp3 plus a manifest.json per tour.
 * Unchanged steps (same text + voice + settings hash) are skipped.
 * The API key is read from the environment only. Never write it to a file.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '..');
const narration = JSON.parse(readFileSync(join(webRoot, 'src/lib/tour/narration.json'), 'utf8'));
const KEY = process.env.ELEVENLABS_API_KEY;
const FORCE = process.argv.includes('--force');
const API = 'https://api.elevenlabs.io/v1';
const MODEL = 'eleven_multilingual_v2';
const FORMAT = 'mp3_44100_128';
const BITRATE = 128_000;
const SETTINGS = { stability: 0.5, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true, speed: 1.0 };
const PREFERRED = (process.env.TOUR_VOICE ?? 'Sarah,Rachel,George').split(',');

if (!KEY) { console.error('Set ELEVENLABS_API_KEY in the environment.'); process.exit(1); }
const headers = { 'xi-api-key': KEY };

async function pickVoice() {
  const r = await fetch(`${API}/voices`, { headers });
  if (!r.ok) throw new Error(`GET /voices ${r.status}`);
  const { voices } = await r.json();
  if (process.argv.includes('--list-voices')) {
    for (const v of voices) console.log(`${v.voice_id}  ${v.name}  ${JSON.stringify(v.labels ?? {})}`);
    process.exit(0);
  }
  for (const want of PREFERRED) {
    const v = voices.find((x) => x.name.toLowerCase().startsWith(want.trim().toLowerCase()));
    if (v) return { id: v.voice_id, name: v.name };
  }
  throw new Error('None of the preferred voices are available');
}

const hash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);

async function main() {
  const voice = await pickVoice();
  console.log(`Voice: ${voice.name} (${voice.id})`);
  let totalBytes = 0, totalMs = 0;
  for (const [tour, steps] of Object.entries(narration)) {
    const dir = join(webRoot, 'public/tutorial', tour);
    mkdirSync(dir, { recursive: true });
    const manifestPath = join(dir, 'manifest.json');
    const prev = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { steps: {} };
    const manifest = { tour, voiceId: voice.id, voiceName: voice.name, model: MODEL, format: FORMAT, settings: SETTINGS, steps: {} };
    for (const s of steps) {
      const h = hash(JSON.stringify([s.text, voice.id, MODEL, FORMAT, SETTINGS]));
      const file = `${s.id}.mp3`;
      const out = join(dir, file);
      if (!FORCE && prev.steps?.[s.id]?.hash === h && existsSync(out)) {
        console.log(`  skip ${tour}/${file}`);
      } else {
        const r = await fetch(`${API}/text-to-speech/${voice.id}?output_format=${FORMAT}`, {
          method: 'POST',
          headers: { ...headers, 'content-type': 'application/json', accept: 'audio/mpeg' },
          body: JSON.stringify({ text: s.text, model_id: MODEL, voice_settings: SETTINGS }),
        });
        if (!r.ok) throw new Error(`TTS ${tour}/${s.id}: ${r.status} ${(await r.text()).slice(0, 200)}`);
        writeFileSync(out, Buffer.from(await r.arrayBuffer()));
        console.log(`  wrote ${tour}/${file}`);
      }
      const bytes = statSync(out).size;
      const durationMs = Math.round((bytes * 8 * 1000) / BITRATE); // CBR 128 kbps
      manifest.steps[s.id] = { file, text: s.text, hash: h, bytes, durationMs };
      totalBytes += bytes; totalMs += durationMs;
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }
  console.log(`Total: ${(totalBytes / 1024 / 1024).toFixed(2)} MB, ${(totalMs / 1000).toFixed(1)} s`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
