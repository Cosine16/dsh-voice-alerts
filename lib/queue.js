/** Serialized playback with expiry, priority, cooldown, and a failing-device circuit breaker. */
export function createQueue(config, play, warn, now = Date.now) {
  let stopped = false, current, blockedUntil = 0;
  const pending = [], last = new Map();
  const routine = new Set(['subagentCreated', 'subagentComplete', 'taskComplete', 'objectiveComplete', 'retrying', 'connectionRestored', 'requestRecovered']);
  const urgent = kind => !routine.has(kind);
  const valid = item => item.valid() && now() - item.at < config.maxAlertAgeMs;
  function failed(error) {
    blockedUntil = now() + config.playbackFailureCooldownMs;
    pending.length = 0;
    warn(error);
  }
  function drain() {
    if (stopped || current || now() < blockedUntil) return;
    let item;
    do { item = pending.shift(); } while (item && (!valid(item) || now() - (last.get(item.key) ?? -Infinity) < config.cooldownMs));
    if (!item) return;
    try {
      const playback = play(item.kind);
      current = { ...playback, key: item.key };
      last.set(item.key, now());
      if (last.size > 256) last.delete(last.keys().next().value);
      item.onPlay();
      Promise.resolve(playback.done).catch(failed).finally(() => { current = undefined; drain(); });
    } catch (error) { current = undefined; failed(error); }
  }
  return {
    enqueue(kind, scope = '', isValid = () => true, onPlay = () => {}) {
      if (stopped || !config.enabled || !config.events[kind] || config.volume === 0 || now() < blockedUntil || !isValid()) return;
      const time = now(), key = `${kind}:${scope}`;
      for (const [entry, at] of last) if (time - at >= config.cooldownMs) last.delete(entry);
      for (let i = pending.length - 1; i >= 0; i--) if (!valid(pending[i])) pending.splice(i, 1);
      if (current?.key === key || last.has(key) || pending.some(item => item.key === key)) return;
      if (pending.length >= config.maxQueue) {
        if (!urgent(kind)) return;
        const index = pending.findIndex(item => !urgent(item.kind));
        pending.splice(index < 0 ? pending.length - 1 : index, 1);
      }
      const item = { kind, key, at: time, valid: isValid, onPlay };
      const index = urgent(kind) ? pending.findIndex(entry => !urgent(entry.kind)) : -1;
      pending.splice(index < 0 ? pending.length : index, 0, item);
      drain();
    },
    dispose() { stopped = true; pending.length = 0; last.clear(); current?.cancel(); },
  };
}
