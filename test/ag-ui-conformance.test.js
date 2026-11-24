import assert from 'node:assert/strict';
import test from 'node:test';
import {A2UIMiddleware} from '@ag-ui/a2ui-middleware';
import {AbstractAgent} from '@ag-ui/client';
import {firstValueFrom, of, toArray} from 'rxjs';
import {createAgUiActivityBinding, withAgUiAction} from '../src/ag-ui.js';
import {basicCatalog} from '../src/protocol.js';
import {withBrowser} from '../test-support/browser.js';
import {assertWireMessage} from '../test-support/wire-check.js';

const input = runId => ({threadId: 'study', runId, tools: [], context: [], state: {}, messages: [],
  forwardedProps: {hostSetting: 'preserved'}});
const creation = {version: '1.0', createSurface: {
  surfaceId: 'workbench', catalogId: basicCatalog.id,
  components: [
    {id: 'root', component: 'Button', child: 'label', action: {event: {name: 'select'}}},
    {id: 'label', component: 'Text', text: 'Select Weaver'},
  ],
}};
const update = text => ({version: '1.0', updateComponents: {
  surfaceId: 'workbench', components: [{id: 'label', component: 'Text', text}],
}});

class FixtureAgent extends AbstractAgent {
  constructor(operations) {
    super();
    this.operations = operations;
  }

  run(request) {
    this.received = request;
    const {runId, threadId} = request;
    const events = [{type: 'RUN_STARTED', runId, threadId}];
    if (this.operations) {
      events.push({type: 'TOOL_CALL_RESULT', role: 'tool', messageId: 'result', toolCallId: 'render',
        content: JSON.stringify({a2ui_operations: this.operations})});
    }
    return of(...events, {type: 'RUN_FINISHED', runId, threadId});
  }
}

function collect(middleware, request, agent) {
  return firstValueFrom(middleware.run(request, agent).pipe(toArray()));
}

test('the published AG-UI middleware drives a mounted A2UI 1.0 activity and receives its browser action', async () => {
  const middleware = new A2UIMiddleware({schema: basicCatalog.toJson()});
  const events = await collect(middleware, input('create'), new FixtureAgent([creation]));
  const event = events.find(event => event.type === 'ACTIVITY_SNAPSHOT' && event.content.a2ui_operations?.length);
  assert.ok(event, JSON.stringify(events));
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    try {
      await page.goto(origin + '/test-support/fixture-host.html');
      await page.evaluate(event => {
        window.activity = window.fixture.agUi(event.messageId);
        window.activity.receiveEvent(event);
      }, event);
      await page.getByRole('button', {name: 'Select Weaver'}).click({timeout: 5000});
      const outbound = await page.evaluate(() => window.fixture.outbound.splice(0));
      assert.equal(outbound.length, 1);
      const {message, metadata} = outbound[0];
      assertWireMessage(message, metadata);

      const agent = new FixtureAgent([creation, update('Weaver selected')]);
      const replies = await collect(middleware, withAgUiAction(input('user_action'), message), agent);
      assert.equal(agent.received.forwardedProps.hostSetting, 'preserved');
      assert.deepEqual(agent.received.forwardedProps.a2uiAction.userAction, message.action);
      assert.equal(agent.received.messages.at(-1).role, 'user');
      assert.ok(agent.received.messages.at(-1).content.endsWith(JSON.stringify(message.action)));

      const next = replies.find(reply => reply.type === 'ACTIVITY_SNAPSHOT' && reply.messageId === event.messageId);
      assert.ok(next, JSON.stringify(replies));
      const button = page.getByRole('button', {name: 'Select Weaver'});
      const mounted = await button.elementHandle();
      assert.deepEqual(next.content.a2ui_operations, [creation, update('Weaver selected')]);
      await page.evaluate(({messageId, activityType, content}) => window.activity.receiveEvent({
        type: 'ACTIVITY_DELTA', messageId, activityType,
        patch: [{op: 'add', path: '/a2ui_operations/-', value: content.a2ui_operations.at(-1)}],
      }), next);
      const updated = page.getByRole('button', {name: 'Weaver selected'});
      await updated.waitFor({timeout: 5000});
      assert.equal(await updated.evaluate((element, before) => element === before, mounted), true);
      await page.evaluate(event => window.activity.receiveEvent(event), next);
      assert.equal(await updated.evaluate((element, before) => element === before, mounted), true);
      assert.deepEqual(await page.evaluate(() => [window.fixture.failures, window.fixture.outbound]), [[], []]);
      await page.evaluate(() => window.activity.dispose());
      assert.equal(await updated.count(), 0);
    } finally {
      await page.close();
    }
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('AG-UI snapshots ignore other activities, avoid replay and rebuild divergent paint once', () => {
  const mounted = [];
  const errors = [];
  const binding = createAgUiActivityBinding({
    messageId: 'mine',
    mount() {
      const view = {operations: [], disposals: 0,
        receive(operation) { this.operations.push(operation); },
        dispose() { this.disposals++; }};
      mounted.push(view);
      return view;
    },
    onTransportError: error => errors.push(error.message),
  });
  const snapshot = (operations, changes = {}) => ({
    type: 'ACTIVITY_SNAPSHOT', activityType: 'a2ui-surface', messageId: 'mine', replace: true,
    content: {a2ui_operations: operations}, ...changes,
  });
  assert.equal(binding.receiveEvent(snapshot([creation], {messageId: 'other'})), false);
  binding.receiveEvent(snapshot([creation], {replace: false}));
  binding.receiveEvent(snapshot([creation]));
  binding.receiveEvent(snapshot([creation, update('Ignored')], {replace: false}));
  binding.receiveEvent(snapshot([creation, update('First')], {replace: undefined}));
  assert.equal(mounted.length, 1);
  assert.deepEqual(mounted[0].operations, [creation, update('First')]);

  binding.receiveEvent(snapshot([creation, {version: '1.0', callRendererFunction: {}}]));
  assert.equal(errors.length, 1);
  assert.equal(mounted.length, 1);
  binding.receiveEvent(snapshot([creation, update('Replacement')]));
  assert.equal(mounted.length, 2);
  assert.equal(mounted[0].disposals, 1);
  assert.deepEqual(mounted[1].operations, [creation, update('Replacement')]);
  assert.throws(() => withAgUiAction(input('rpc'), {version: '1.0', callAgentFunction: {}}), TypeError);
  binding.dispose();
  assert.equal(mounted[1].disposals, 1);
  assert.equal(binding.receiveEvent(snapshot([creation])), false);
});

test('AG-UI deltas preserve the last accepted content after an invalid patch', () => {
  const views = [];
  const errors = [];
  const binding = createAgUiActivityBinding({messageId: 'mine', mount() {
    const view = {operations: [], disposeCount: 0,
      receive(operation) { this.operations.push(operation); },
      dispose() { this.disposeCount++; }};
    views.push(view);
    return view;
  }, onTransportError: error => errors.push(error)});
  const route = {activityType: 'a2ui-surface', messageId: 'mine'};
  const delta = (patch, target = route) => binding.receiveEvent({type: 'ACTIVITY_DELTA', ...target, patch});
  const append = {op: 'add', path: '/a2ui_operations/-', value: update('Appended')};
  assert.equal(delta([append]), true);
  assert.equal(views.length, 0);
  const initial = {phase: 'waiting', a2ui_operations: [creation]};
  binding.receiveEvent({type: 'ACTIVITY_SNAPSHOT', ...route, content: initial});
  assert.equal(delta([append], {...route, messageId: 'other'}), false);
  assert.equal(delta([append], {...route, activityType: 'progress'}), false);
  delta([append, {op: 'remove', path: '/missing'}]);
  delta([{op: 'replace', path: '/a2ui_operations', value: [{version: '0.9'}]}]);
  assert.equal(errors.length, 2);
  assert.deepEqual(views[0].operations, [creation]);
  delta([{op: 'test', path: '/phase', value: 'waiting'}, append]);
  assert.equal(errors.length, 2);
  assert.deepEqual(views[0].operations, [creation, update('Appended')]);
  assert.deepEqual(initial, {phase: 'waiting', a2ui_operations: [creation]});
  assert.equal(views.length, 1);
  delta([{op: 'replace', path: '/a2ui_operations/1', value: update('Corrected')}]);
  assert.equal(views[0].disposeCount, 1);
  assert.equal(views.length, 2);
  assert.deepEqual(views[1].operations, [creation, update('Corrected')]);
  binding.dispose();
});
