import { readFileSync, writeFileSync } from 'node:fs';
import { phrases } from '../lib/config.js';

// Run once after generate-audio.ps1: light radio filtering and a two-tone preamble.
for (const kind of Object.keys(phrases)) {
  if (process.argv[2] && process.argv[2] !== kind) continue;
  const url = new URL(`../audio/${kind}.wav`, import.meta.url);
  const source = readFileSync(url);
  let data;
  let rate;
  for (let at = 12; at + 8 <= source.length;) {
    const tag = source.toString('ascii', at, at + 4);
    const size = source.readUInt32LE(at + 4);
    if (tag === 'fmt ') {
      if (source.readUInt16LE(at + 8) !== 1 || source.readUInt16LE(at + 10) !== 1 || source.readUInt16LE(at + 22) !== 16) throw new Error('Expected mono PCM16');
      rate = source.readUInt32LE(at + 12);
    }
    if (tag === 'data') data = source.subarray(at + 8, at + 8 + size);
    at += size + 8 + size % 2;
  }
  if (!data || !rate) throw new Error('Invalid WAV');
  const preamble = Math.round(rate * 0.23);
  const pcm = Buffer.alloc(preamble * 2 + data.length);
  for (let i = 0; i < preamble; i++) {
    const t = i / rate;
    const segment = t < 0.07 ? [0, 880] : t >= 0.09 && t < 0.16 ? [0.09, 1174.66] : null;
    if (!segment) continue;
    const phase = t - segment[0];
    const envelope = Math.min(1, phase / 0.008, (0.07 - phase) / 0.008);
    pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * segment[1] * phase) * 3800 * envelope), i * 2);
  }
  let previous = 0, high = 0, low = 0;
  const highAlpha = 1 / (1 + 2 * Math.PI * 180 / rate);
  const lowAlpha = (2 * Math.PI * 3500 / rate) / (1 + 2 * Math.PI * 3500 / rate);
  for (let i = 0; i < data.length / 2; i++) {
    const sample = data.readInt16LE(i * 2) / 32768;
    high = highAlpha * (high + sample - previous);
    previous = sample;
    low += lowAlpha * (high - low);
    const radio = Math.tanh(low * 1.8) * 0.8;
    pcm.writeInt16LE(Math.round(radio * 32767), (preamble + i) * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  writeFileSync(url, Buffer.concat([header, pcm]));
  console.log(`${kind}: ${(pcm.length / 2 / rate).toFixed(2)}s`);
}
