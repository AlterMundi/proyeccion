import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import test from 'node:test';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
import {basicCatalog} from '../src/protocol.js';
import {withBrowser} from '../test-support/browser.js';
import {assertWireCapabilities, assertWireMessage} from '../test-support/wire-check.js';

const uri = 'a2ui://bench/layout';
const mimeType = 'application/a2ui+json';
const resource = (envelopes, resourceUri = uri) => ({
  uri: resourceUri, mimeType, text: JSON.stringify(envelopes),
});
const payload = (title, revision) => ({title, revision});
const update = (title, revision) => ({version: '1.0', updateDataModel: {
  surfaceId: 'bench', path: '/', value: payload(title, revision),
}});
const layout = [{version: '1.0', createSurface: {
  surfaceId: 'bench', catalogId: basicCatalog.id, sendDataModel: true,
  dataModel: payload('Initial resource', 1),
  components: [
    {id: 'root', component: 'Column', children: ['title', 'confirm']},
    {id: 'title', component: 'Text', text: {'@path': '/title'}},
    {id: 'confirm', component: 'Button', child: 'label', action: {event: {
      name: 'confirm', context: {revision: {'@path': '/revision'}},
    }}},
    {id: 'label', component: 'Text', text: 'Confirm selection'},
  ],
}}];

test('An MCP server supplies an A2UI layout and receives a native action and scoped state', {timeout: 30000}, async () => {
  const mcp = new McpServer({name: 'test-layout-app', version: '1.0.0'});
  const client = new Client({name: 'test-renderer-host', version: '1.0.0'}, {capabilities: {
    a2ui: {rendererCapabilities: {'1.0': {supportedCatalogIds: [basicCatalog.id]}}},
  }});
  const calls = [];
  mcp.registerResource('bench layout', uri, {mimeType}, async () => ({contents: [resource(layout)]}));
  mcp.registerTool('a2ui_action', {inputSchema: {
    name: z.string(), sourceComponentId: z.string(), surfaceId: z.string(), timestamp: z.string(),
    context: z.record(z.string(), z.unknown()),
  }}, async (action, {_meta}) => {
    calls.push({action, metadata: _meta});
    return {content: [
      {type: 'text', text: 'Application confirmation'},
      {type: 'resource', resource: {...resource([], uri + '/other'), mimeType: 'text/plain'}},
      {type: 'resource', resource: {...resource([], uri + '/bad'), text: '{'}},
      {type: 'resource', resource: resource([update('Confirmed by application', 2)], uri + '/data'),
        annotations: {audience: ['user']}},
      {type: 'resource', resource: resource([update('Assistant context only', 99)], uri + '/assistant'),
        annotations: {audience: ['assistant']}},
    ]};
  });
  mcp.registerTool('a2ui_error', {inputSchema: {
    code: z.string(), message: z.string(), surfaceId: z.string().optional(), path: z.string().optional(),
  }}, async (error, {_meta}) => {
    calls.push({error, metadata: _meta});
    return {content: [{type: 'text', text: 'Received validation error'}]};
  });
  const transport = new StreamableHTTPServerTransport({sessionIdGenerator: () => 'test-session'});
  const http = createServer((request, response) => transport.handleRequest(request, response));
  try {
    http.listen(0, '127.0.0.1');
    await once(http, 'listening');
    await mcp.connect(transport);
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:' + http.address().port)));
    // The published SDK strips the guide's custom initialize capability at schema parsing.
    assert.equal(mcp.server.getClientCapabilities().a2ui, undefined);
    await withBrowser(async (browser, origin) => {
      const page = await browser.newPage();
      await page.exposeFunction('errorReceived', () => calls.length === 2);
      await page.exposeFunction('mcpRead', params => client.readResource(params));
      await page.exposeFunction('mcpCall', params => client.callTool(params));
      await page.goto(origin + '/test-support/fixture-host.html');
      await page.evaluate(async layoutUri => {
        const {binding, view} = window.fixture.mcpTransport({
          readResource: window.mcpRead, callTool: window.mcpCall,
        });
        window.mcpBinding = binding;
        window.mcpView = view;
        await binding.readLayout(layoutUri);
      }, uri);
      await page.getByText('Initial resource', {exact: true}).waitFor();
      await page.getByRole('button', {name: 'Confirm selection'}).click();
      await page.getByText('Confirmed by application', {exact: true}).waitFor();
      assert.equal(await page.getByText('Assistant context only', {exact: true}).count(), 0);
      assert.equal(await page.getByText('Application confirmation', {exact: true}).count(), 0);
      assert.equal((await page.evaluate(() => window.fixture.failures)).length, 1);
      const [{action, metadata}] = calls;
      assertWireMessage({version: '1.0', action}, metadata);
      assertWireCapabilities(metadata.a2ui.rendererCapabilities);
      assert.deepEqual(metadata.a2ui.rendererCapabilities['1.0'].supportedCatalogIds, [basicCatalog.id]);
      assert.equal(action.name, 'confirm');
      assert.equal(action.sourceComponentId, 'confirm');
      assert.equal(action.surfaceId, 'bench');
      assert.deepEqual(action.context, {revision: 1});
      assert.deepEqual(metadata.a2uiRendererDataModel.surfaces, {bench: payload('Initial resource', 1)});

      await page.evaluate(() => window.mcpView.receive({
        version: '1.0', createSurface: {surfaceId: 'invalid', catalogId: 'urn:missing-catalog'},
      }));
      // The renderer doesn't await outbound diagnostics. Wait for the receiving MCP tool.
      await page.waitForFunction(() => window.errorReceived(), null, {timeout: 5000});
      const {error, metadata: errorMetadata} = calls[1];
      assertWireMessage({version: '1.0', error}, errorMetadata);
      assert.equal(error.surfaceId, 'invalid');
      await page.evaluate(() => window.mcpView.dispose());
      await page.close();
    }, process.env.PROYECCION_BROWSER_PROJECT);
  } finally {
    await client.close();
    await mcp.close();
    http.closeAllConnections();
    if (http.listening) await new Promise((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
  }
});
