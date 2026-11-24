import assert from 'node:assert/strict';
import {EventEmitter, once} from 'node:events';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {DataContext} from '@a2ui/web_core';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {z} from 'zod';
import {createMcpAppCatalog} from '../src/mcp.js';
import {createProtocol} from '../src/protocol.js';
import {withBrowser} from '../test-support/browser.js';
import {assertWireCapabilities, assertWireMessage} from '../test-support/wire-check.js';

const catalog = JSON.parse(readFileSync(new URL('./fixtures/a2ui-v1/catalogs/mcp.json', import.meta.url)));
const sandbox = process.env.PROYECCION_BROWSER_PROJECT
  ? pathToFileURL(resolve(process.env.PROYECCION_BROWSER_PROJECT, 'node_modules/@a2ui/catalog-mcp/sandbox') + '/')
  : new URL('../node_modules/@a2ui/catalog-mcp/sandbox/', import.meta.url);

async function serveSandbox(page, onProxyLoad = () => {}) {
  await page.route('**/a2ui-sandbox/sandbox.html*', route => {
    onProxyLoad();
    return route.fulfill({body: readFileSync(new URL('sandbox.html', sandbox)), contentType: 'text/html'});
  });
  await page.route('**/a2ui-sandbox/sandbox.js', route => route.fulfill({
    body: readFileSync(new URL('sandbox.js', sandbox)), contentType: 'text/javascript',
  }));
}

const html = `<!doctype html>
<title>Fixture MCP application</title>
<p id="value">Waiting for model</p>
<p id="result">Waiting for action</p>
<button id="select">Select fixture</button>
<button id="outside">Unlisted action</button>
<script>
  const send = (method, params, id) => parent.postMessage({
    jsonrpc: '2.0', method, params, ...(id === undefined ? {} : {id}),
  }, '*');
  addEventListener('message', event => {
    if (event.source !== parent) return;
    const message = event.data;
    if (message?.id === 1 && message.result) {
      send('ui/notifications/initialized', {});
    } else if (message?.method === 'ui/notifications/data-model-update' && message.params.key === 'selection') {
      document.querySelector('#value').textContent = 'Model: ' + message.params.value;
    } else if (message?.id === 2 && message.result) {
      document.querySelector('#result').textContent = 'Action forwarded';
    } else if (message?.id === 3 && message.error) {
      document.querySelector('#result').textContent = 'Action denied';
    }
  });
  document.querySelector('#select').onclick = () =>
    send('tools/call', {name: 'selectFixture', arguments: {selection: 'mode-2'}}, 2);
  document.querySelector('#outside').onclick = () =>
    send('tools/call', {name: 'unlistedFixture', arguments: {}}, 3);
  send('ui/initialize', {protocolVersion: '2025-11-21', appInfo: {name: 'fixture', version: '1'},
    appCapabilities: {}}, 1);
</script>`;

test('a host-approved MCP App receives bound data, sends a listed action and stays in its sandbox', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', entry => { if (entry.type() === 'error' || entry.type() === 'warning') errors.push(entry.text()); });
    let proxyLoads = 0;
    await serveSandbox(page, () => proxyLoads++);
    await page.goto(origin + '/test-support/fixture-host.html');
    const advertised = await page.evaluate(async html => {
      const {fixture} = window;
      const id = await fixture.addMcpAppCatalog(request => request.surfaceId === 'fixture'
        && request.componentId === 'root' && request.resource.html === html
        && request.resource.csp === undefined && request.resource.permissions === undefined
        && request.allowedFunctions === undefined
        && request.allowedTools?.length === 1 && request.allowedTools[0] === 'selectFixture'
        && request.data?.paths.selection === '/selection');
      return {id, capabilities: fixture.projection.capabilities()};
    }, html);
    assert.equal(advertised.id, catalog.catalogId);
    assertWireCapabilities(advertised.capabilities);
    assert.ok(advertised.capabilities['1.0'].supportedCatalogIds.includes(catalog.catalogId));
    const receive = body => page.evaluate(body => window.fixture.projection.receive({version: '1.0', ...body}), body);
    const component = htmlContent => ({id: 'root', component: 'McpApp', title: 'Fixture MCP application',
      htmlContent, allowedTools: ['selectFixture'], data: {paths: {selection: '/selection'}}});
    await receive({createSurface: {
      surfaceId: 'fixture', catalogId: catalog.catalogId, dataModel: {selection: 'mode-1'},
      components: [component('Unapproved content')],
    }});
    const outer = page.frameLocator('iframe[title="Fixture MCP application"]');
    const inner = outer.frameLocator('iframe');
    await page.locator('iframe[title="Fixture MCP application"]').waitFor();
    assert.equal(await inner.getByText('Unapproved content').count(), 0);
    assert.deepEqual(await page.evaluate(() => window.fixture.outbound), []);

    await receive({updateComponents: {surfaceId: 'fixture', components: [component(html)]}});
    try {
      await inner.getByText('Model: mode-1', {exact: true}).waitFor();
    } catch (error) {
      const frames = await Promise.all(page.frames().map(async frame => ({url: frame.url(), body: await frame.locator('body').innerText()})));
      assert.fail(JSON.stringify({error: error.message, errors, frames, proxyLoads,
        outputs: await page.evaluate(() => [window.fixture.outbound, window.fixture.failures])}));
    }
    const isolation = await inner.locator('body').evaluate(() => {
      try { return parent.document.body ? 'shared' : 'missing'; }
      catch (error) { return error.name; }
    });
    assert.equal(isolation, 'SecurityError');
    assert.ok(proxyLoads > 0);
    assert.equal(await outer.locator('iframe').getAttribute('sandbox'), 'allow-scripts');
    await receive({updateDataModel: {surfaceId: 'fixture', path: '/selection', value: 'mode-2'}});
    await inner.getByText('Model: mode-2', {exact: true}).waitFor();

    await inner.getByRole('button', {name: 'Select fixture'}).click();
    await inner.getByText('Action forwarded', {exact: true}).waitFor();
    await page.waitForFunction(() => window.fixture.outbound.length === 1);
    const [sent] = await page.evaluate(() => window.fixture.outbound.splice(0));
    assertWireMessage(sent.message, sent.metadata);
    const {name, surfaceId, sourceComponentId, context} = sent.message.action;
    assert.deepEqual({name, surfaceId, sourceComponentId, context}, {
      name: 'selectFixture', surfaceId: 'fixture', sourceComponentId: 'root', context: {selection: 'mode-2'},
    });
    await inner.getByRole('button', {name: 'Unlisted action'}).click();
    await inner.getByText('Action denied', {exact: true}).waitFor();
    assert.deepEqual(await page.evaluate(() => [window.fixture.outbound, window.fixture.failures]), [[], []]);

    await receive({updateComponents: {surfaceId: 'fixture', components: [
      {...component(html), allowedTools: ['unlistedFixture']},
    ]}});
    await inner.getByRole('button', {name: 'Select fixture'}).waitFor({state: 'detached'});
    await receive({deleteSurface: {surfaceId: 'fixture'}});
    await page.locator('iframe[title="Fixture MCP application"]').waitFor({state: 'detached'});
    await page.close();
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('the MCP catalog forwards a headless call to its agent and applies the returned data locally', async () => {
  let surface;
  const sent = [];
  const runtime = createProtocol({
    catalogs: [createMcpAppCatalog({authorizeApp: () => false})],
    send: (message, metadata) => sent.push({message, metadata}),
    onSurfaceCreated: created => { surface = created; },
  });
  const frame = (kind, body) => ({version: '1.0', [kind]: body});
  try {
    await runtime.receive(frame('createSurface', {surfaceId: 'fixture', catalogId: catalog.catalogId}));
    const pending = new DataContext(surface, '/').resolveAction({functionCall: {
      '@call': 'updateDataModel', args: {updates: {'@call': 'transformData', args: {
        jmespath: '{"/preview": json.selection}',
        data: {'@call': 'callMcpTool', args: {name: 'readFixture', arguments: {selection: 'mode-2'}}},
      }}},
    }});
    await setImmediate();
    assert.equal(sent.length, 1, JSON.stringify(sent));
    const [{message, metadata}] = sent.splice(0);
    assertWireMessage(message, metadata, [catalog]);
    assert.deepEqual(message.callAgentFunction.callFunction, {
      '@call': 'callMcpTool', catalogId: catalog.catalogId,
      args: {name: 'readFixture', arguments: {selection: 'mode-2'}},
    });
    await runtime.receive(frame('agentFunctionResponse', {
      functionCallId: message.callAgentFunction.functionCallId, value: {json: {selection: 'mode-2'}},
    }));
    await pending;
    assert.equal(surface.dataModel.get('/preview'), 'mode-2');
    assert.deepEqual(sent, []);
  } finally {
    runtime.dispose();
  }
});

const directApp = `<!doctype html>
<p id="status">Waiting for bridge</p>
<button data-tool="lookup" data-key="active">Lookup</button>
<button data-tool="blocked">Try listed tool</button>
<button data-tool="unlisted">Try unlisted tool</button>
<button data-tool="lookup" data-key="pending">Start pending lookup</button>
<script>
  const result = document.querySelector('#status');
  const send = (method, params, id) => parent.postMessage({
    jsonrpc: '2.0', method, params, ...(id === undefined ? {} : {id}),
  }, '*');
  window.addEventListener('message', event => {
    if (event.source !== parent) return;
    const message = event.data;
    if (message?.id === 1 && message.result) {
      send('ui/notifications/initialized', {});
      result.textContent = 'Ready';
    } else if (message?.id >= 2) {
      const reply = message.result;
      result.textContent = message.error ? 'Unlisted rejected' : reply?.isError ? 'Host denied'
        : reply?.structuredContent?.label + ' (' + reply?.content?.length + ')';
    }
  });
  let id = 1;
  for (const button of document.querySelectorAll('button')) {
    button.onclick = () => send('tools/call', {name: button.dataset.tool,
      arguments: {key: button.dataset.key ?? 'denied'}}, ++id);
  }
  send('ui/initialize', {protocolVersion: '2025-11-21', appInfo: {name: 'direct-app', version: '1'},
    appCapabilities: {}}, 1);
</script>`;

test('a sandboxed MCP App receives approved tool results and cancels a pending call at teardown', {timeout: 25000}, async () => {
  const server = new McpServer({name: 'test-app-tools', version: '1.0.0'});
  const client = new Client({name: 'test-app-host', version: '1.0.0'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const decisions = [];
  const calls = [];
  const lifecycle = new EventEmitter();
  const pendingCall = new AbortController();
  server.registerTool('lookup', {inputSchema: {key: z.string()}}, ({key}, {signal}) => {
    calls.push(key);
    if (key === 'pending') {
      return new Promise(resolve => {
        signal.addEventListener('abort', () => {
          lifecycle.emit('cancelled');
          resolve({content: []});
        }, {once: true});
        lifecycle.emit('started');
      });
    }
    return {structuredContent: {label: 'Server selection'}, content: [
      {type: 'text', text: 'Visible result'},
      {type: 'text', text: 'Assistant-only result', annotations: {audience: ['assistant']}},
    ]};
  });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await withBrowser(async (browser, origin) => {
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      await serveSandbox(page);
      await page.exposeFunction('authorizeAppTool', request => {
        decisions.push(request);
        return request.name === 'lookup' && request.surfaceId === 'fixture' && request.componentId === 'root';
      });
      await page.exposeFunction('runAppTool', request => client.callTool(request, undefined, {
        signal: request.arguments.key === 'pending' ? pendingCall.signal : undefined,
      }));
      await page.exposeFunction('cancelAppTool', () => pendingCall.abort());
      await page.goto(origin + '/test-support/fixture-host.html');
      await page.evaluate(async html => {
        const {fixture} = window;
        const catalogId = await fixture.addDirectMcpTools(async request => {
          if (!await window.authorizeAppTool(request)) return;
          return {
            callTool(message, _, {signal}) {
              if (message.arguments.key === 'pending') {
                signal.addEventListener('abort', () => window.cancelAppTool(), {once: true});
              }
              return window.runAppTool(message);
            },
          };
        }, {authorizeApp: ({resource, surfaceId, allowedTools}) => resource.html === html
          && surfaceId === 'fixture' && allowedTools?.join(',') === 'lookup,blocked'});
        fixture.projection.receive({version: '1.0', createSurface: {surfaceId: 'fixture', catalogId,
          components: [{id: 'root', component: 'McpApp', title: 'Direct MCP App',
            htmlContent: html, allowedTools: ['lookup', 'blocked']}],
        }});
      }, directApp);
      const frame = page.frameLocator('iframe[title="Direct MCP App"]').frameLocator('iframe');
      await frame.getByText('Ready', {exact: true}).waitFor();
      await frame.getByRole('button', {name: 'Lookup', exact: true}).click();
      await frame.getByText('Server selection (1)', {exact: true}).waitFor();
      await frame.getByRole('button', {name: 'Try listed tool', exact: true}).click();
      await frame.getByText('Host denied', {exact: true}).waitFor();
      await frame.getByRole('button', {name: 'Try unlisted tool', exact: true}).click();
      await frame.getByText('Unlisted rejected', {exact: true}).waitFor();

      await Promise.all([
        once(lifecycle, 'started', {signal: AbortSignal.timeout(8000)}),
        frame.getByRole('button', {name: 'Start pending lookup', exact: true}).click(),
      ]);
      await Promise.all([
        once(lifecycle, 'cancelled', {signal: AbortSignal.timeout(8000)}),
        page.evaluate(() => window.fixture.projection.receive({
          version: '1.0', deleteSurface: {surfaceId: 'fixture'},
        })),
      ]);
      await page.locator('iframe[title="Direct MCP App"]').waitFor({state: 'detached'});
      assert.deepEqual(calls, ['active', 'pending']);
      assert.deepEqual(decisions, [
        {name: 'lookup', arguments: {key: 'active'}, surfaceId: 'fixture', componentId: 'root'},
        {name: 'blocked', arguments: {key: 'denied'}, surfaceId: 'fixture', componentId: 'root'},
        {name: 'lookup', arguments: {key: 'pending'}, surfaceId: 'fixture', componentId: 'root'},
      ]);
      assert.deepEqual(await page.evaluate(() => window.fixture.outbound), []);
      await page.close();
    }, process.env.PROYECCION_BROWSER_PROJECT);
  } finally {
    await client.close();
    await server.close();
  }
});
