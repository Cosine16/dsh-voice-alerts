import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { registerEvents } from '../lib/events.js';
import { createQueue } from '../lib/queue.js';
const defaults = JSON.parse(readFileSync(new URL('../settings.json', import.meta.url)));

function harness(options = {}) {
  const listeners = new Map(), cleanups = [], sounds = [];
  const session = { id: 'main', header: {}, ...options.session };
  const agent = { session };
  const ctx = { on(name, fn) { listeners.set(name, fn); }, effect(fn) { cleanups.push(fn()); } };
  const config = { ...defaults, errorCoalesceMs: 5, ...options.config };
  const queue = { enqueue(kind, scope, valid = () => true, onPlay = () => {}) { if(config.events[kind] && valid()) sounds.push({kind, scope, valid, onPlay}); }, dispose() {} };
  registerEvents(ctx, queue, config);
  return {
    session, agent, sounds,
    emit(name, ...args) { return listeners.get(name)(...args); },
    event(type, data) { listeners.get('session/event')(session, {type, data}); },
    kinds() { return sounds.filter(x => x.valid()).map(x => x.kind); },
    dispose() { cleanups.forEach(fn => fn()); },
  };
}
test('denial and unavailable approval outcomes suppress matching tool failures', async () => {
  const h = harness();
  h.event('approval/asked', {id:'a',callId:'tool1'});
  h.event('approval/decided', {id:'a',outcome:'rejected'});
  h.emit('tools/result', {agent:h.agent,callId:'tool1',rootCallId:'tool1'}, {isError:true,error:{message:'denied'}});
  h.event('approval/asked', {id:'b'});
  h.event('approval/decided', {id:'b',outcome:'unavailable'});
  h.event('approval/decided', {id:'c',outcome:'cancelled'});
  await delay(15);
  assert.deepEqual(h.kinds(), ['accessDenied','authorizationUnavailable']);
  h.dispose();
});
test('retry is only announced after recorded policy decision, recovery requires successful response', () => {
  const h = harness();
  const payload = {agent:h.agent, failure:{code:'TRANSPORT'}, turn:1, step:1};
  assert.equal(h.emit('agent/request-error', payload, () => undefined), undefined);
  assert.deepEqual(h.kinds(), ['connectionLost']);
  h.sounds[0].onPlay();
  h.event('llm/retry', {...payload, retry:1});
  h.event('llm/retry', {...payload, retry:2});
  assert.deepEqual(h.kinds(), ['connectionLost','retrying']);
  h.event('assistant/attempt', {});
  assert.deepEqual(h.kinds(), ['connectionLost','retrying']);
  h.event('assistant/message', {});
  assert.deepEqual(h.kinds(), ['connectionRestored']);
  h.event('assistant/message', {});
  assert.equal(h.sounds.filter(x=>x.kind==='connectionRestored').length,1);
  h.event('turn/start', {turn:2});
  assert.deepEqual(h.kinds(), []);
  h.dispose();
});
test('silent or quickly resolved faults do not produce orphaned recovery announcements', () => {
  const h=harness();
  h.emit('agent/request-error', {agent:h.agent,failure:{code:'TIMEOUT'}}, ()=>undefined);
  h.event('assistant/message',{});
  assert.deepEqual(h.kinds(),[]);
  h.dispose();
});
test('timeout recovery differs from network restoration and does not follow turn completion alone', () => {
  const h=harness();
  h.emit('agent/request-error', {agent:h.agent,failure:{code:'TIMEOUT'}}, ()=>undefined);
  h.sounds[0].onPlay();
  h.event('turn/end',{reason:{kind:'completed'}});
  assert.equal(h.kinds().includes('requestRecovered'),false);
  h.event('assistant/message',{});
  assert.equal(h.kinds().includes('requestRecovered'),true);
  h.dispose();
});
test('goal progression separates active rounds, blocked objective and objective completion', () => {
  const h=harness();
  h.event('goal/change',{operation:'create',goal:{id:'g',phase:'active'}});
  h.event('turn/end',{reason:{kind:'completed'}});
  assert.deepEqual(h.kinds(),[]);
  h.event('goal/change',{operation:'block',goal:{id:'g',phase:'blocked'}});
  assert.deepEqual(h.kinds(),['objectiveBlocked']);
  h.event('goal/change',{operation:'resume',goal:{id:'g',phase:'active'}});
  assert.deepEqual(h.kinds(),[]);
  h.event('goal/change',{operation:'complete',goal:{id:'g',phase:'complete'}});
  h.event('turn/end',{reason:{kind:'completed'}});
  assert.deepEqual(h.kinds(),['objectiveComplete']);
  h.dispose();
});
test('restored active goal is read without announcing old events', () => {
  const h=harness({session:{snapshotEvents:()=>[{type:'goal/change',data:{operation:'create',goal:{phase:'active'}}}]}});
  h.event('turn/end',{reason:{kind:'completed'}});
  assert.deepEqual(h.kinds(),[]);h.dispose();
});
test('user cancellation is configurable, parent stop and subagent failure are distinct', () => {
  const h=harness();
  h.event('turn/end',{reason:{kind:'aborted',reason:{kind:'user'}}});
  assert.deepEqual(h.kinds(),[]);
  h.event('turn/end',{reason:{kind:'aborted',reason:{kind:'parent'}}});
  h.emit('subagent/end',{id:'child',stopReason:'error'});
  assert.deepEqual(h.kinds(),['taskStopped','subagentFailed']);h.dispose();
  const audible=harness({config:{events:{...defaults.events,taskCancelled:true}}});
  audible.event('turn/end',{reason:{kind:'aborted',reason:{kind:'user'}}});
  assert.deepEqual(audible.kinds(),['taskCancelled']);audible.dispose();
});
test('failed compaction is announced once and later success invalidates pending warning', async () => {
  const h=harness();
  h.event('compaction/end',{error:'summary failed'});
  h.emit('agent/error',{agent:h.agent,error:new Error('summary failed')});
  h.event('turn/end',{reason:{kind:'error',error:{code:'UNKNOWN'}}});
  await delay(15);
  assert.deepEqual(h.kinds(),['compactionFailed']);
  h.event('compaction/end',{});
  assert.deepEqual(h.kinds(),[]);h.dispose();
});
test('nested failures coalesce by root call, successful outer recovery withdraws alert', async () => {
  const h=harness();
  const failed={isError:true,error:{message:'failure'}};
  h.emit('tools/result',{agent:h.agent,callId:'inner',rootCallId:'outer'},failed);
  h.emit('tools/result',{agent:h.agent,callId:'outer',rootCallId:'outer'},failed);
  await delay(15);
  assert.deepEqual(h.kinds(),['toolFailed']);
  h.emit('tools/result',{agent:h.agent,callId:'outer',rootCallId:'outer'},{isError:false});
  assert.deepEqual(h.kinds(),[]);h.dispose();
});
test('aborted tools and errors without an agent never announce a tool failure', async () => {
  const h=harness();
  h.emit('tools/result',{agent:h.agent,callId:'1'},{isError:true,error:{info:{code:'ABORTED'}}});
  h.emit('tools/result',{callId:'2'},{isError:true,error:{message:'error'}});
  await delay(15);assert.deepEqual(h.kinds(),[]);h.dispose();
});
test('turn-end errors are classified and generic agent errors coalesce', async () => {
  const h=harness();
  h.emit('agent/error',{agent:h.agent,error:new Error('401')});
  h.event('turn/end',{reason:{kind:'error',error:{code:'HTTP_401'}}});
  await delay(15);assert.deepEqual(h.kinds(),['authenticationFailed']);h.dispose();
});
test('dispose cancels deferred announcements and invalidates queued errors', async () => {
  const h=harness();
  h.emit('agent/error',{agent:h.agent,error:new Error('error')});
  h.dispose();await delay(15);assert.deepEqual(h.kinds(),[]);
});
test('queue expires old work and does not cooldown a discarded warning', async () => {
  let time=1000, resolve;
  const played=[];
  const q=createQueue(defaults, kind=>{played.push(kind);return{done:new Promise(r=>{resolve=r;}),cancel(){}};},assert.fail,()=>time);
  q.enqueue('taskComplete','busy');
  q.enqueue('accessDenied','a');
  time+=defaults.maxAlertAgeMs+1;
  resolve();await delay(0);
  assert.deepEqual(played,['taskComplete']);
  q.enqueue('accessDenied','a');
  assert.deepEqual(played,['taskComplete','accessDenied']);
  q.dispose();resolve();
});
test('subagent terminal error does not repeat an already announced request failure', () => {
  const h=harness({session:{id:'child',header:{origin:'subagent'}}});
  h.emit('subagent/start',{id:'child'});
  h.emit('agent/request-error',{agent:h.agent,failure:{code:'TRANSPORT'}},()=>undefined);
  h.sounds.find(x=>x.kind==='connectionLost').onPlay();
  h.emit('session/disposed',h.session);
  h.emit('subagent/end',{id:'child',stopReason:'error'});
  assert.equal(h.sounds.some(x=>x.kind==='subagentFailed'),false);h.dispose();
});
test('nested authorization denial also suppresses the enclosing transport tool error', async () => {
  const h=harness();
  h.event('approval/asked',{id:'a',callId:'inner'});
  h.event('approval/decided',{id:'a',outcome:'rejected'});
  const failed={isError:true,error:{message:'denied'}};
  h.emit('tools/result',{agent:h.agent,callId:'inner',rootCallId:'outer'},failed);
  h.emit('tools/result',{agent:h.agent,callId:'outer',rootCallId:'outer'},failed);
  await delay(15);assert.deepEqual(h.kinds(),['accessDenied']);h.dispose();
});
