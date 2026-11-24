import assert from 'node:assert/strict';
import test from 'node:test';
import {basicCatalog} from '../src/protocol.js';
import {withBrowser} from '../test-support/browser.js';
import {assertWireCapabilities, assertWireMessage} from '../test-support/wire-check.js';

const catalogId = 'fixture/http';
const surfaceId = 'bench';
const message = (kind, body) => ({version: '1.0', [kind]: body});
const update = (title, revision) => message('updateDataModel', {
  surfaceId, path: '/', value: {title, revision},
});
const snapshot = message('createSurface', {
  surfaceId, catalogId: basicCatalog.id, sendDataModel: true, dataModel: {title: 'Initial title', revision: 1},
  components: [
    {id: 'root', component: 'Column', children: ['title', 'inspect', 'choose']},
    {id: 'title', component: 'Text', text: {'@path': '/title'}},
    {id: 'inspect', component: 'Button', child: 'inspect_label', action: {event: {name: 'inspect', context: {}}}},
    {id: 'inspect_label', component: 'Text', text: 'Inspect local title'},
    {id: 'choose', component: 'Button', child: 'choose_label', action: {event: {name: 'choose', context: {
      title: {'@call': 'chooseTitle', catalogId, args: {revision: {'@path': '/revision'}}},
    }}}},
    {id: 'choose_label', component: 'Text', text: 'Ask for a title'},
  ],
});

test('HTTP turns apply ordered updates and return renderer and agent function replies', {timeout: 25000}, async () => {
  const exchanges = [];
  const plugin = {
    name: 'fixture-http-turn',
    configureServer(server) {
      server.middlewares.use('/fixture-turn', async (request, response) => {
        let raw = '';
        for await (const chunk of request.setEncoding('utf8')) raw += chunk;
        const body = JSON.parse(raw);
        exchanges.push(body);
        const [envelope] = body.messages;
        let messages;
        if (exchanges.length === 1) messages = [snapshot];
        else if (envelope?.action?.name === 'inspect') messages = [
          update('Before function', 2),
          message('callRendererFunction', {surfaceId, functionCallId: 'read_local',
            callFunction: {'@call': 'readTitle', catalogId, args: {title: {'@path': '/title'}}}}),
          update('After function was dispatched', 3),
        ];
        else if (envelope?.rendererFunctionResponse) messages = [update('Local reply received', 4)];
        else if (envelope?.callAgentFunction) messages = [
          message('agentFunctionResponse', {functionCallId: envelope.callAgentFunction.functionCallId, value: 'Remote title'}),
        ];
        else if (envelope?.action?.name === 'choose') messages = [update(envelope.action.context.title, 5)];
        if (!messages) response.writeHead(204).end();
        else response.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify({messages}));
      });
    },
  };
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(origin + '/test-support/fixture-host.html');
    await page.evaluate(catalogId => {
      const {binding, view} = window.fixture.httpTurn({url: '/fixture-turn',
        agentCapabilities: {'1.0': {acceptsInlineCatalogs: true}}, inlineCatalogIds: [catalogId]}, catalogId);
      window.httpTurn = binding;
      window.httpView = view;
      return binding.poll();
    }, catalogId);
    await page.getByText('Initial title', {exact: true}).waitFor();
    await page.getByRole('button', {name: 'Inspect local title'}).click();
    await page.getByText('Local reply received', {exact: true}).waitFor();
    await page.getByRole('button', {name: 'Ask for a title'}).click();
    await page.getByText('Remote title', {exact: true}).waitFor();
    await page.evaluate(() => window.httpTurn.poll());
    assert.equal(exchanges.length, 6);

    const [initial, action, localReply, remoteCall, remoteAction, empty] = exchanges;
    for (const {metadata} of exchanges) assertWireCapabilities(metadata.a2uiRendererCapabilities);
    assert.deepEqual(initial.messages, []);
    assert.deepEqual(empty.messages, []);
    assert.equal(initial.metadata.a2uiRendererDataModel, undefined);
    const caps = initial.metadata.a2uiRendererCapabilities['1.0'];
    assert.deepEqual(caps.supportedCatalogIds, [basicCatalog.id, catalogId]);
    assert.equal(caps.inlineCatalogs[0].catalogId, catalogId);
    for (const {messages, metadata} of [action, localReply, remoteCall, remoteAction]) {
      assert.equal(messages.length, 1);
      assertWireMessage(messages[0], metadata, caps.inlineCatalogs);
      assert.deepEqual(Object.keys(metadata.a2uiRendererDataModel.surfaces), [surfaceId]);
    }
    assert.equal(action.metadata.a2uiRendererDataModel.surfaces.bench.revision, 1);
    assert.deepEqual(localReply.messages[0].rendererFunctionResponse, {functionCallId: 'read_local', value: 'Before function'});
    assert.deepEqual(remoteCall.messages[0].callAgentFunction.callFunction, {
      '@call': 'chooseTitle', catalogId, args: {revision: 4},
    });
    assert.equal(remoteCall.metadata.a2uiRendererDataModel.surfaces.bench.revision, 4);
    assert.deepEqual(remoteAction.messages[0].action.context, {title: 'Remote title'});
    assert.deepEqual(await page.evaluate(() => window.fixture.failures), []);
    await page.evaluate(() => { window.httpTurn.dispose(); window.httpView.dispose(); });
    await page.close();
  }, process.env.PROYECCION_BROWSER_PROJECT, [plugin]);
});
