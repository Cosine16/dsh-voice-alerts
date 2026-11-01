const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
const { join } = require('node:path');

async function main() {
  const install = process.argv[2];
  if (!install) throw new Error('Pass the Desktop installation directory');
  const modules = join(install, 'resources/app.asar/dsh/node_modules/@deepseek-ai');
  const { Context } = require(join(modules, 'cordis'));
  const plugin = await import(pathToFileURL(join(__dirname, '../index.js')).href);
  const { registerEvents } = await import(pathToFileURL(join(__dirname, '../lib/events.js')).href);
  const settings = require('../settings.json');
  const root = new Context();
  const fiber = await root.plugin(plugin, { volume: 0 });
  await fiber.dispose();
  const spoken = [];
  let disposed = false;
  const observer = await root.plugin(ctx => registerEvents(ctx, {
    enqueue(kind, scope, valid = () => true, onPlay = () => {}) { if (valid()) { spoken.push(kind); onPlay(); } },
    dispose() { disposed = true; },
  }, { ...settings, approvalDelayMs: 0 }));
  const result = await root.waterfall('approval/request', { reason: 'sudo needed' }, () => new Promise(resolve => setTimeout(() => resolve('rejected'), 30)));
  assert.equal(result, 'rejected');
  assert.deepEqual(spoken, ['privilege']);
  root.emit('subagent/start', { id: 'test-child', runId: '1', provider: 'test', local: false });
  root.emit('subagent/end', { id: 'test-child', stopReason: 'completed' });
  root.emit('session/event', { id: 'test-parent', header: {} }, { type: 'turn/end', data: { reason: { kind: 'completed' } } });
  assert.deepEqual(spoken, ['privilege', 'subagentCreated', 'subagentComplete', 'taskComplete']);
  const session = { id: 'extended-parent', header: {} }, agent = { session };
  const event = (type, data) => root.emit('session/event', session, { type, data });
  event('approval/asked', { id: 'approval1', callId: 'call1' });
  event('approval/decided', { id: 'approval1', outcome: 'unavailable' });
  const action = { kind: 'retry' };
  assert.equal(await root.waterfall('agent/request-error', { agent, failure: { code: 'TRANSPORT' }, turn: 1, step: 1 }, () => action), action);
  event('llm/retry', { turn: 1, step: 1, failure: { code: 'TRANSPORT' } });
  event('assistant/message', {});
  event('goal/change', { operation: 'complete', goal: { phase: 'complete' } });
  assert.deepEqual(spoken.slice(4), ['authorizationUnavailable', 'connectionLost', 'retrying', 'connectionRestored', 'objectiveComplete']);
  const beforeDisposal = spoken.length;
  await observer.dispose();
  assert.equal(disposed, true);
  root.emit('subagent/start', { id: 'after-disposal' });
  assert.equal(spoken.length, beforeDisposal);
  await root.fiber.dispose();
  console.log('PASS: installed Cordis loads plugin, preserves authorization, emits alerts and disposes listeners.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
