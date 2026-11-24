import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {setImmediate} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {DataContext} from '@a2ui/web_core';
import {createMcpAppCatalog} from '../src/mcp.js';
import {createProtocol} from '../src/protocol.js';
import {withBrowser} from '../test-support/browser.js';
import {assertWireCapabilities, assertWireMessage} from '../test-support/wire-check.js';

const catalog = JSON.parse(readFileSync(new URL('./fixtures/a2ui-v1/catalogs/mcp.json', import.meta.url)));
const sandbox = process.env.PROYECCION_BROWSER_PROJECT
  ? pathToFileURL(resolve(process.env.PROYECCION_BROWSER_PROJECT, 'node_modules/@a2ui/catalog-mcp/sandbox') + '/')
  : new URL('../node_modules/@a2ui/catalog-mcp/sandbox/', import.meta.url);
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
    await page.route('**/a2ui-sandbox/sandbox.html*', route => {
      proxyLoads++;
      return route.fulfill({body: readFileSync(new URL('sandbox.html', sandbox)), contentType: 'text/html'});
    });
    await page.route('**/a2ui-sandbox/sandbox.js', route => route.fulfill({
      body: readFileSync(new URL('sandbox.js', sandbox)), contentType: 'text/javascript',
    }));
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
