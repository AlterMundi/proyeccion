import assert from 'node:assert/strict';
import {EventEmitter, once} from 'node:events';
import {createServer} from 'node:http';
import test from 'node:test';
import {basicCatalog} from '../src/protocol.js';
import {withBrowser} from '../test-support/browser.js';
import {assertWireCapabilities, assertWireMessage} from '../test-support/wire-check.js';

const snapshot = {version: '1.0', createSurface: {
  surfaceId: 'bench', catalogId: basicCatalog.id, sendDataModel: true,
  dataModel: {title: 'First selection', revision: 1},
  components: [
    {id: 'root', component: 'Column', children: ['title', 'confirm']},
    {id: 'title', component: 'Text', text: {'@path': '/title'}},
    {id: 'confirm', component: 'Button', child: 'label', action: {event: {
      name: 'confirm', context: {revision: {'@path': '/revision'}},
    }}},
    {id: 'label', component: 'Text', text: 'Confirm selection'},
  ],
}};
const update = (title, revision) => ({version: '1.0', updateDataModel: {
  surfaceId: 'bench', path: '/', value: {title, revision},
}});
const readCatalogId = 'fixture/sse';

test('SSE resumes the same A2UI view while JSON-RPC sends actions and state in order', {timeout: 25000}, async () => {
  const streams = [];
  const requests = [];
  const network = new EventEmitter();
  async function awaitCounts(streamCount, requestCount) {
    const signal = AbortSignal.timeout(5000);
    while (streams.length < streamCount || requests.length < requestCount) {
      await once(network, 'change', {signal});
    }
    assert.equal(streams.length, streamCount);
    assert.equal(requests.length, requestCount);
  }
  const server = createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {'Access-Control-Allow-Headers': 'content-type, last-event-id',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'}).end();
      return;
    }
    if (request.url === '/stream') {
      response.writeHead(200, {'Content-Type': 'text/event-stream'});
      response.write('retry: 50\n\n');
      streams.push({response, lastId: request.headers['last-event-id']});
      network.emit('change');
      return;
    }
    let text = '';
    for await (const chunk of request) text += chunk;
    requests.push({request: JSON.parse(text), response});
    network.emit('change');
  });
  const receipt = ({request, response}, fields = {result: null}) => {
    response.writeHead(200, {'Content-Type': 'application/json'});
    response.end(JSON.stringify({jsonrpc: '2.0', id: request.id, ...fields}));
  };
  const writeEvent = ({response}, id, text) => {
    const data = text.split('\n').map(line => 'data: ' + line).join('\n');
    response.write('id: ' + id + '\nevent: a2ui\n' + data + '\n\n');
  };
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    await withBrowser(async (browser, origin) => {
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      await page.goto(origin + '/test-support/fixture-host.html');
      await page.evaluate(({base, readCatalogId}) => {
        const {binding, view} = window.fixture.sseTransport({streamUrl: base + '/stream', rpcUrl: base + '/rpc'}, readCatalogId);
        window.binding = binding;
        window.view = view;
        window.offer = binding.advertise();
        binding.connect();
      }, {base: 'http://127.0.0.1:' + server.address().port, readCatalogId});
      await awaitCounts(1, 1);
      assert.equal(requests[0].request.method, 'a2ui.capabilities');
      const capabilities = requests[0].request.params.metadata.a2uiRendererCapabilities;
      assertWireCapabilities(capabilities);
      assert.deepEqual(capabilities['1.0'].supportedCatalogIds, [basicCatalog.id, readCatalogId]);
      receipt(requests[0]);
      assert.equal(await page.evaluate(() => window.offer), null);

      writeEvent(streams[0], '1', '{');
      writeEvent(streams[0], '2', JSON.stringify(snapshot, null, 2));
      await page.getByText('First selection', {exact: true}).waitFor();
      const original = await page.locator('a2ui-surface').elementHandle();
      const button = page.getByRole('button', {name: 'Confirm selection'});
      await button.click();
      await awaitCounts(1, 2);
      writeEvent(streams[0], '3', JSON.stringify(update('Server update', 2)));
      await page.getByText('Server update', {exact: true}).waitFor();
      await button.click();
      // The second click ran after revision 2 arrived. It did not overtake the first receipt.
      assert.equal(requests.length, 2);
      writeEvent(streams[0], '4', JSON.stringify(update('Newer server update', 3)));
      await page.getByText('Newer server update', {exact: true}).waitFor();
      receipt(requests[1], {result: update('Receipt is not a projection update', 99)});
      await awaitCounts(1, 3);
      assert.equal(await page.getByText('Receipt is not a projection update', {exact: true}).count(), 0);
      receipt(requests[2], {id: -1, result: null});
      await page.waitForFunction(() => window.fixture.failures.includes('Invalid JSON-RPC receipt'));

      streams[0].response.end();
      await awaitCounts(2, 3);
      assert.equal(streams[1].lastId, '4');
      writeEvent(streams[1], '5', JSON.stringify(update('Resumed selection', 4)));
      await page.getByText('Resumed selection', {exact: true}).waitFor();
      assert.equal(await page.locator('a2ui-surface').evaluate((element, previous) => element === previous, original), true);
      await button.click();
      await awaitCounts(2, 4);
      receipt(requests[3]);

      for (const [index, revision] of [1, 2, 4].entries()) {
        const {request} = requests[index + 1];
        assert.equal(request.jsonrpc, '2.0');
        assert.equal(request.id, index + 2);
        assert.equal(request.method, 'a2ui.send');
        const {envelope, metadata} = request.params;
        assertWireMessage(envelope, metadata);
        assert.equal(envelope.action.context.revision, revision);
        assert.equal(metadata.a2uiRendererDataModel.surfaces.bench.revision, revision);
      }
      writeEvent(streams[1], '6', JSON.stringify({version: '1.0', callRendererFunction: {
        surfaceId: 'bench', functionCallId: 'current-title',
        callFunction: {'@call': 'readTitle', catalogId: readCatalogId, args: {title: {'@path': '/title'}}},
      }}));
      await awaitCounts(2, 5);
      const {envelope, metadata} = requests[4].request.params;
      assertWireMessage(envelope, metadata);
      assert.deepEqual(envelope.rendererFunctionResponse, {functionCallId: 'current-title', value: 'Resumed selection'});
      assert.equal(metadata.a2uiRendererDataModel.surfaces.bench.revision, 4);
      receipt(requests[4]);
      assert.equal((await page.evaluate(() => window.fixture.failures)).length, 2);
      const closed = once(streams[1].response, 'close');
      await page.evaluate(() => { window.binding.dispose(); window.view.dispose(); });
      await closed;
      await page.close();
    }, process.env.PROYECCION_BROWSER_PROJECT);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
