import { readFileSync, accessSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { phrases, validateConfig } from './lib/config.js';
import { createQueue } from './lib/queue.js';
import { registerEvents } from './lib/events.js';

export const name = 'voice-alerts';
const root = fileURLToPath(new URL('.', import.meta.url));

/** Start one hidden, bounded Windows PCM playback process. */
export function playAudio(kind, config) {
  const child = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', join(root, 'scripts', 'play.ps1'), '-AudioPath', join(root, 'audio', `${kind}.wav`), '-Volume', String(config.volume),
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-2000); });
  let cancelled = false;
  const done = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Voice playback timed out')); }, config.playbackTimeoutMs);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', code => {
      clearTimeout(timeout);
      if (cancelled || code === 0) resolve();
      else reject(new Error(`Voice playback failed (${code}): ${stderr.trim()}`));
    });
  });
  return { done, cancel() { cancelled = true; child.kill(); } };
}

/** Load local settings, verify assets, and attach disposable event observers. */
export function apply(ctx, overrides = {}) {
  const defaults = JSON.parse(readFileSync(join(root, 'settings.json'), 'utf8'));
  const config = validateConfig({ ...defaults, ...overrides, events: { ...defaults.events, ...overrides.events } });
  if (!config.enabled) return;
  if (process.platform !== 'win32') throw new Error('Voice alerts currently requires Windows');
  for (const kind of Object.keys(phrases)) if (config.events[kind]) accessSync(join(root, 'audio', `${kind}.wav`));
  const queue = createQueue(config, kind => playAudio(kind, config), error => ctx.logger.warn(`voice-alerts: ${error.message}`));
  registerEvents(ctx, queue, config);
  ctx.logger.info('voice-alerts: offline voice notifications enabled');
}
