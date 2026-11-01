import { approvalKind, failureKind } from './config.js';

/** Event observers preserve authorization, retries and execution results unchanged. */
export function registerEvents(ctx, queue, config) {
  const timers = new Set(), children = new Set(), childFailures = new Map(), states = new WeakMap();
  let disposed = false;
  function state(session) {
    let value = states.get(session);
    if (!value) {
      const goalEvent = session.snapshotEvents?.().findLast(event => event.type === 'goal/change');
      value = { epoch: 0, goal: goalEvent?.data.operation === 'clear' ? undefined : goalEvent?.data.goal, approvals: new Map(), denied: new Set(), toolErrors: new Map(), specificAt: -Infinity };
      states.set(session, value);
    }
    return value;
  }
  function later(fn) {
    const timer = setTimeout(() => { timers.delete(timer); if (!disposed) fn(); }, config.errorCoalesceMs);
    timers.add(timer);
  }
  function announce(kind, session, valid = () => true, onPlay) {
    queue.enqueue(kind, session?.id ?? '', () => !disposed && valid(), onPlay);
  }
  function specific(kind, session, valid = () => true) {
    const s = state(session), epoch = s.epoch;
    s.specificAt = Date.now();
    announce(kind, session, () => s.epoch === epoch && valid());
  }
  function failure(session, fact, position = {}) {
    const s = state(session), kind = failureKind(fact);
    if (s.failure?.active && s.failure.kind === kind && s.failure.turn === position.turn && s.failure.step === position.step) return s.failure;
    if (s.failure) s.failure.active = false;
    const incident = { kind, active: true, heard: false, retry: false, turn: position.turn, step: position.step };
    s.failure = incident;
    if (children.has(session.id)) childFailures.set(session.id, incident);
    announce(kind, session, () => incident.active, () => { incident.heard = true; });
    return incident;
  }
  function recovered(session) {
    const s = state(session), incident = s.failure;
    if (!incident?.active) return;
    incident.active = false;
    if (incident.heard) announce(incident.kind === 'connectionLost' ? 'connectionRestored' : 'requestRecovered', session, () => !incident.active && s.failure === incident);
  }
  function pending(kind, request, next) {
    if (request.signal?.aborted) return next();
    let active = true;
    const timer = setTimeout(() => {
      timers.delete(timer);
      announce(kind, request.agent?.session, () => active && !request.signal?.aborted);
    }, config.approvalDelayMs);
    timers.add(timer);
    const clear = () => { active = false; clearTimeout(timer); timers.delete(timer); };
    try { return Promise.resolve(next()).finally(clear); }
    catch (error) { clear(); throw error; }
  }
  ctx.on('approval/request', (request, next) => pending(approvalKind(request), request, next), { prepend: true });
  ctx.on('user-questions/request', (request, next) => pending('inputRequired', request, next), { prepend: true });
  ctx.on('agent/request-error', (payload, next) => {
    if (!payload.signal?.aborted) failure(payload.agent.session, payload.failure, payload);
    return next();
  }, { prepend: true });
  ctx.on('agent/error', ({ agent, error, turn, step }) => {
    const session = agent.session, s = state(session), epoch = s.epoch;
    later(() => {
      if (s.epoch !== epoch || s.failure?.active || Date.now() - s.specificAt < config.errorCoalesceMs * 2 + 1 || s.terminalReported) return;
      failure(session, error?.failure ?? error, { turn, step });
    });
  });
  ctx.on('subagent/start', info => { children.add(info.id); queue.enqueue('subagentCreated', info.id); });
  ctx.on('subagent/end', info => {
    children.delete(info.id);
    const prior = childFailures.get(info.id);
    childFailures.delete(info.id);
    if (prior) prior.active = false;
    if (info.stopReason === 'error' && prior?.heard) return;
    const kind = { completed: 'subagentComplete', error: 'subagentFailed', 'max-tokens': 'tokenLimit', blocked: 'taskBlocked', aborted: 'taskCancelled' }[info.stopReason];
    if (kind) queue.enqueue(kind, info.id);
  });
  ctx.on('tools/result', (exec, result) => {
    if (!exec.agent) return;
    const session = exec.agent.session, s = state(session), root = exec.rootCallId ?? exec.callId;
    if (!result.isError) {
      const prior = s.toolErrors.get(root);
      if (prior) prior.active = false;
      s.toolErrors.delete(root);
      return;
    }
    const code = result.error.info?.code;
    if (s.denied.has(exec.callId)) { s.denied.add(root); return; }
    if (exec.signal?.aborted || ['ABORTED', 'ABORTED_BEFORE_DISPATCH'].includes(code) || s.denied.has(root) || s.toolErrors.has(root)) return;
    const incident = { active: true }, epoch = s.epoch;
    s.toolErrors.set(root, incident);
    if (s.toolErrors.size > 128) { const key = s.toolErrors.keys().next().value; s.toolErrors.get(key).active = false; s.toolErrors.delete(key); }
    later(() => {
      if (!incident.active || s.epoch !== epoch || s.denied.has(exec.callId) || s.denied.has(root)) return;
      s.specificAt = Date.now();
      announce('toolFailed', session, () => incident.active && s.epoch === epoch);
    });
  });
  ctx.on('session/event', (session, event) => {
    const s = state(session), data = event.data;
    switch (event.type) {
      case 'turn/start':
        s.epoch++;
        if (s.failure) s.failure.active = false;
        s.failure = undefined; s.terminalReported = false; s.goalAnnounced = false; s.specificAt = -Infinity;
        s.approvals.clear(); s.denied.clear(); s.toolErrors.clear();
        return;
      case 'approval/asked':
        s.approvals.set(data.id, data.callId);
        if (s.approvals.size > 128) s.approvals.delete(s.approvals.keys().next().value);
        return;
      case 'approval/decided': {
        const callId = s.approvals.get(data.id);
        s.approvals.delete(data.id);
        if (data.outcome !== 'rejected' && data.outcome !== 'unavailable') return;
        if (callId) { s.denied.add(callId); if (s.denied.size > 128) s.denied.delete(s.denied.values().next().value); }
        specific(data.outcome === 'rejected' ? 'accessDenied' : 'authorizationUnavailable', session);
        return;
      }
      case 'llm/retry': {
        const incident = s.failure?.active ? s.failure : failure(session, data.failure, data);
        if (incident.retry) return;
        incident.retry = true;
        announce('retrying', session, () => incident.active && incident.retry);
        return;
      }
      case 'assistant/message': recovered(session); return;
      case 'goal/change': {
        s.goal = data.operation === 'clear' ? undefined : data.goal;
        const kind = { block: 'objectiveBlocked', complete: 'objectiveComplete' }[data.operation];
        if (kind) {
          s.goalAnnounced = true;
          const goal = s.goal;
          announce(kind, session, () => s.goal === goal);
        }
        return;
      }
      case 'compaction/end':
        if (data.error !== undefined) {
          s.compactionFailed = true;
          specific('compactionFailed', session, () => s.compactionFailed);
        } else s.compactionFailed = false;
        return;
      case 'turn/end': {
        const reason = data.reason, epoch = s.epoch;
        const child = session.header.origin === 'subagent' || children.has(session.id);
        if (reason.kind === 'error') {
          s.terminalReported = true;
          if (child) return;
          if (s.failure?.active || Date.now() - s.specificAt < config.errorCoalesceMs * 2 + 1) return;
          later(() => {
            if (s.epoch === epoch && Date.now() - s.specificAt >= config.errorCoalesceMs) failure(session, reason.error, data);
          });
          return;
        }
        if (reason.kind === 'completed') {
          if (!child && s.goal?.phase !== 'active' && !s.goalAnnounced) announce('taskComplete', session, () => s.epoch === epoch && s.goal?.phase !== 'active' && !s.goalAnnounced);
          return;
        }
        if (s.failure) s.failure.active = false;
        if (child) return;
        if (reason.kind === 'max-tokens') specific('tokenLimit', session);
        else if (reason.kind === 'blocked') specific('taskBlocked', session, () => !s.goalAnnounced);
        else if (reason.kind === 'aborted') specific(reason.reason?.kind === 'user' ? 'taskCancelled' : 'taskStopped', session);
        return;
      }
    }
  });
  ctx.on('session/disposed', session => {
    // Subagent/end is published after child disposal; retain its incident until that edge.
    const s = states.get(session);
    if (s) { s.epoch++; if (s.failure) s.failure.active = false; }
    states.delete(session);
  });
  ctx.effect(() => () => {
    disposed = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear(); children.clear(); childFailures.clear(); queue.dispose();
  });
}
