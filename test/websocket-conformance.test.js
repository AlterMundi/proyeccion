import assert from 'node:assert/strict';
import {EventEmitter, once} from 'node:events';
import test from 'node:test';
import {WebSocketServer} from 'ws';
import {basicCatalog} from '../src/protocol.js';
import {withBrowser} from '../test-support/browser.js';
import {assertWireCapabilities, assertWireMessage} from '../test-support/wire-check.js';

const catalogId = 'fixture/websocket';
const surfaceId = 'bench';
const message = (kind, body) => ({version: '1.0', [kind]: body});
const update = (title, revision) => message('updateDataModel', {surfaceId, path: '/', value: {title, revision}});
const snapshot = message('createSurface', {
  surfaceId, catalogId: basicCatalog.id, sendDataModel: true, dataModel: {title: 'Connected', revision: 1},
  components: [
    {id: 'root', component: 'Column', children: ['title', 'choose']},
    {id: 'title', component: 'Text', text: {'@path': '/title'}},
    {id: 'choose', component: 'Button', child: 'choose_label', action: {event: {name: 'choose', context: {
      title: {'@call': 'chooseTitle', catalogId, args: {revision: {'@path': '/revision'}}},
    }}}},
    {id: 'choose_label', component: 'Text', text: 'Ask the server'},
  ],
});

test('WebSocket frames negotiate capabilities and carry two-way A2UI RPC', {timeout: 25000}, async () => {
  const server = new WebSocketServer({host: '127.0.0.1', port: 0});
  const received = [];
  const activity = new EventEmitter();
  server.on('connection', socket => {
    socket.on('message', text => {
      received.push(JSON.parse(text.toString()));
      activity.emit('frame');
    });
  });
  async function frame(index) {
    const signal = AbortSignal.timeout(5000);
    while (received.length <= index) await once(activity, 'frame', {signal});
    return received[index];
  }
  try {
    await once(server, 'listening');
    await withBrowser(async (browser, origin) => {
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      await page.goto(origin + '/test-support/fixture-host.html');
      const [[socket]] = await Promise.all([
        once(server, 'connection', {signal: AbortSignal.timeout(5000)}),
        page.evaluate(({url, catalogId}) => {
          const {binding, view} = window.fixture.webSocket(new WebSocket(url), catalogId);
          window.binding = binding;
          window.view = view;
        }, {url: 'ws://127.0.0.1:' + server.address().port, catalogId}),
      ]);
      const send = (messages, metadata) => socket.send(JSON.stringify({messages, metadata}));
      const initial = await frame(0);
      assert.deepEqual(initial.messages, []);
      assertWireCapabilities(initial.metadata.a2uiRendererCapabilities);
      assert.deepEqual(initial.metadata.a2uiRendererCapabilities['1.0'], {supportedCatalogIds: [basicCatalog.id, catalogId]});

      send([], {a2uiAgentCapabilities: {'1.0': {acceptsInlineCatalogs: true}}});
      const offered = await frame(1);
      const caps = offered.metadata.a2uiRendererCapabilities;
      assertWireCapabilities(caps);
      assert.deepEqual(caps['1.0'].inlineCatalogs.map(doc => doc.catalogId), [catalogId]);
      send([], {a2uiAgentCapabilities: {'1.0': {acceptsInlineCatalogs: true}}});
      socket.send('{');
      send([snapshot, update('Current title', 2)]);
      await page.getByText('Current title', {exact: true}).waitFor();
      assert.equal(received.length, 2);

      await page.getByRole('button', {name: 'Ask the server'}).click();
      const remote = await frame(2);
      assertWireMessage(remote.messages[0], remote.metadata, caps['1.0'].inlineCatalogs);
      const {functionCallId, callFunction} = remote.messages[0].callAgentFunction;
      assert.deepEqual(callFunction, {'@call': 'chooseTitle', catalogId, args: {revision: 2}});
      assert.equal(remote.metadata.a2uiRendererDataModel.surfaces.bench.revision, 2);

      send([
        update('Server update', 3),
        message('callRendererFunction', {surfaceId, functionCallId: 'inspect_title',
          callFunction: {'@call': 'readTitle', catalogId, args: {title: {'@path': '/title'}}}}),
        update('After server call', 4),
      ]);
      const reply = await frame(3);
      assertWireMessage(reply.messages[0], reply.metadata);
      assert.deepEqual(reply.messages[0].rendererFunctionResponse, {functionCallId: 'inspect_title', value: 'Server update'});
      await page.getByText('After server call', {exact: true}).waitFor();

      send([message('agentFunctionResponse', {functionCallId, value: 'Chosen title'})]);
      const action = await frame(4);
      assertWireMessage(action.messages[0], action.metadata);
      assert.deepEqual(action.messages[0].action.context, {title: 'Chosen title'});
      assert.equal(action.metadata.a2uiRendererDataModel.surfaces.bench.revision, 4);
      send([update('Chosen title', 5)], {a2uiAgentCapabilities: {'1.0': {acceptsInlineCatalogs: false}}});
      assert.equal((await frame(5)).metadata.a2uiRendererCapabilities['1.0'].inlineCatalogs, undefined);
      await page.getByText('Chosen title', {exact: true}).waitFor();
      assert.equal((await page.evaluate(() => window.fixture.failures)).length, 1);
      await assert.rejects(page.evaluate(() => window.binding.send({data: 'x'.repeat(1024 * 1024)})), /buffer exceeds/);
      const startPendingCall = () => page.evaluate(({surfaceId, catalogId}) => {
        window.closedCall = null;
        [...document.querySelectorAll('a2ui-surface')]
          .find(element => element.surface.id === surfaceId).surface
          .callAgentFunction({'@call': 'chooseTitle', catalogId, args: {revision: 5}})
          .then(value => ({value}), error => ({code: error.code}))
          .then(result => { window.closedCall = result; });
      }, {surfaceId, catalogId});
      await startPendingCall();
      assert.equal((await frame(6)).messages[0].callAgentFunction.surfaceId, surfaceId);
      const closed = once(socket, 'close', {signal: AbortSignal.timeout(5000)});
      socket.close(1000);
      await closed;
      await page.waitForFunction(() => window.closedCall, null, {timeout: 1800});
      assert.deepEqual(await page.evaluate(() => window.closedCall), {code: 'CANCELLED'});
      await page.getByText('Chosen title', {exact: true}).waitFor();
      assert.equal(await page.evaluate(() => window.view.hasSurface('bench')), true);
      await page.evaluate(() => { window.binding.dispose(); window.view.dispose(); });

      const [[secondSocket]] = await Promise.all([
        once(server, 'connection', {signal: AbortSignal.timeout(5000)}),
        page.evaluate(({url, catalogId}) => {
          const {binding, view} = window.fixture.webSocket(new WebSocket(url), catalogId);
          Object.assign(window, {binding, view});
        }, {url: 'ws://127.0.0.1:' + server.address().port, catalogId}),
      ]);
      await frame(7);
      secondSocket.send(JSON.stringify({messages: [snapshot]}));
      await page.getByText('Connected', {exact: true}).waitFor();
      await startPendingCall();
      assert.equal((await frame(8)).messages[0].callAgentFunction.surfaceId, surfaceId);
      await Promise.all([
        once(secondSocket, 'close', {signal: AbortSignal.timeout(5000)}),
        page.evaluate(() => window.binding.dispose()),
      ]);
      await page.waitForFunction(() => window.closedCall, null, {timeout: 1800});
      assert.deepEqual(await page.evaluate(() => window.closedCall), {code: 'CANCELLED'});
      await page.getByText('Connected', {exact: true}).waitFor();
      await page.evaluate(() => window.view.dispose());
      assert.equal(received.length, 9);
      await page.close();
    }, process.env.PROYECCION_BROWSER_PROJECT);
  } finally {
    for (const socket of server.clients) socket.terminate();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
