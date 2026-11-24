import assert from 'node:assert/strict';
import {EventEmitter, once} from 'node:events';
import {createServer} from 'node:http';
import test from 'node:test';
import {A2uiGenerator, CatalogConfig, DirectJsonFormatFactory, resolveCatalogs} from '@a2ui/agent';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
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

test('Per-call MCP metadata offers only selected catalogs to an accepting A2UI agent', {timeout: 30000}, async () => {
  const server = new McpServer({name: 'test-inline-catalogs', version: '1.0.0'});
  const client = new Client({name: 'test-renderer-host', version: '1.0.0'});
  const catalogId = 'urn:test:mcp-inline-catalog';
  const otherId = 'urn:test:mcp-other-catalog';
  const offers = [];
  const knownCatalogs = [new CatalogConfig(basicCatalog)];
  server.registerTool('open_catalog_view', {inputSchema: z.object({})}, (_, {_meta}) => {
    const capabilities = _meta?.a2ui?.rendererCapabilities;
    offers.push(capabilities);
    if (capabilities === undefined) return {content: []};
    assertWireCapabilities(capabilities);
    const catalogs = resolveCatalogs(knownCatalogs, capabilities, true);
    if (!catalogs.some(catalog => catalog.id === catalogId)) return {content: []};
    const generator = new A2uiGenerator(catalogs.map(catalog => new CatalogConfig(catalog)),
      undefined, new DirectJsonFormatFactory());
    const processor = generator.createProcessor(capabilities);
    const create = {version: '1.0', createSurface: {
      surfaceId: 'mcp_inline', catalogId,
      components: [{id: 'root', component: 'StatusBadge', badgeText: 'Catalog received over MCP'}],
    }};
    const messages = processor.parseResponse('<a2ui-json>' + JSON.stringify([create]) + '</a2ui-json>',
      {state: processor.createState()}).flatMap(part => part.a2ui ?? []);
    assert.equal(messages.length, 1);
    return {content: [{type: 'resource', resource: resource(messages)}]};
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await withBrowser(async (browser, origin) => {
      const page = await browser.newPage();
      await page.exposeFunction('callMcp', params => client.callTool(params));
      await page.goto(origin + '/test-support/fixture-host.html');
      const rejections = await page.evaluate(async ({catalogId, otherId}) => {
        const accepts = {'1.0': {acceptsInlineCatalogs: true}};
        const callOptions = [
          {agentCapabilities: accepts, inlineCatalogIds: [catalogId], perCallCapabilities: false},
          {inlineCatalogIds: [catalogId]},
          {agentCapabilities: accepts},
          {agentCapabilities: accepts, inlineCatalogIds: ['urn:test:unregistered']},
          {agentCapabilities: accepts, inlineCatalogIds: [catalogId, catalogId]},
        ];
        const errors = [];
        for (const options of callOptions) {
          const {binding, view} = window.fixture.mcpTransport({callTool: window.callMcp},
            {catalogIds: [catalogId, otherId], ...options});
          try {
            const result = await binding.callTool('open_catalog_view', {});
            if (result.isError) errors.push(result.content);
          } catch (error) {
            errors.push(error.message);
          }
          if (!view.hasSurface('mcp_inline')) view.dispose();
        }
        return errors;
      }, {catalogId, otherId});
      assert.deepEqual(rejections, ['Cannot advertise an unregistered inline catalog: urn:test:unregistered']);
      await page.getByText('Catalog received over MCP', {exact: true}).waitFor({timeout: 5000});
      const idsOnly = {'1.0': {supportedCatalogIds: [basicCatalog.id, catalogId, otherId]}};
      assert.deepEqual(offers.slice(0, 3), [undefined, idsOnly, idsOnly]);
      assert.equal(offers.length, 4);
      assert.deepEqual(offers[3]['1.0'].inlineCatalogs.map(catalog => catalog.catalogId), [catalogId]);
      await page.close();
    }, process.env.PROYECCION_BROWSER_PROJECT);
  } finally {
    await client.close();
    await server.close();
  }
});

test('A native A2UI action calls only the approved MCP tool and renders its latest result', {timeout: 30000}, async () => {
  const server = new McpServer({name: 'test-direct-tools', version: '1.0.0'});
  const client = new Client({name: 'test-renderer-host', version: '1.0.0'});
  const calls = [];
  const requests = new EventEmitter();
  server.registerTool('readMode', {inputSchema: {mode: z.string()}}, ({mode}) => new Promise(resolve => {
    calls.push({mode, resolve});
    requests.emit('call');
  }));
  async function waitForCalls(count) {
    const signal = AbortSignal.timeout(5000);
    while (calls.length < count) await once(requests, 'call', {signal});
    assert.equal(calls.length, count);
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await withBrowser(async (browser, origin) => {
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      const decisions = [];
      const resultsReturned = [];
      await page.exposeFunction('authorizeMcp', request => {
        decisions.push(request);
        return request.name === 'readMode' && request.surfaceId === 'bench';
      });
      await page.exposeFunction('callMcp', async request => {
        const result = await client.callTool(request);
        resultsReturned.push(request.arguments.mode);
        return result;
      });
      await page.goto(origin + '/test-support/fixture-host.html');
      const catalogId = await page.evaluate(() => window.fixture.addDirectMcpTools(async request =>
        (await window.authorizeMcp(request)) ? {callTool: window.callMcp} : undefined));
      const button = (id, name, mode) => ({id, component: 'Button', child: id + '_label',
        action: {functionCall: {'@call': 'callMcpTool', catalogId,
          args: {name, arguments: {mode}, targetDataPath: '/toolResult'}}}});
      const label = (id, text) => ({id, component: 'Text', text});
      const receive = envelope => page.evaluate(envelope => window.fixture.projection.receive(envelope), envelope);
      await receive({version: '1.0', createSurface: {
        surfaceId: 'bench', catalogId: basicCatalog.id,
        dataModel: {mode: 'older', status: 'Before tool', toolResult: {structuredContent: {title: 'No tool result'}}},
        components: [
          {id: 'root', component: 'Column', children: ['status', 'result', 'plain', 'passive', 'old', 'new', 'failure', 'blocked']},
          label('status', {'@path': '/status'}), label('result', {'@path': '/toolResult/structuredContent/title'}),
          label('plain', {'@path': '/toolResult/text'}),
          label('passive', {'@call': 'callMcpTool', catalogId, args: {name: 'readMode', arguments: {mode: 'passive'}}}),
          button('old', 'readMode', {'@path': '/mode'}), label('old_label', 'Request older view'),
          button('new', 'readMode', 'newer'), label('new_label', 'Request newer view'),
          button('failure', 'readMode', 'failed'), label('failure_label', 'Request failed view'),
          button('blocked', 'unapprovedMcpTool', 'denied'), label('blocked_label', 'Try unapproved tool'),
        ],
      }});
      await page.getByRole('button', {name: 'Request older view'}).click();
      await waitForCalls(1);
      await page.getByRole('button', {name: 'Request newer view'}).click();
      await waitForCalls(2);
      assert.deepEqual(calls.map(call => call.mode), ['older', 'newer']);
      const toolResult = mode => ({
        structuredContent: {title: 'Tool result: ' + mode},
        content: [
          {type: 'text', text: JSON.stringify({mode})},
          {type: 'resource', resource: resource([{version: '1.0', updateDataModel: {
            surfaceId: 'bench', path: '/status', value: 'Server status: ' + mode,
          }}])},
          {type: 'text', text: 'Assistant-only content', annotations: {audience: ['assistant']}},
        ],
      });
      calls[1].resolve(toolResult('newer'));
      await page.getByText('Tool result: newer', {exact: true}).waitFor();
      await page.getByText('Server status: newer', {exact: true}).waitFor();
      await page.getByText('{"mode":"newer"}', {exact: true}).waitFor();
      calls[0].resolve(toolResult('older'));
      await page.getByRole('button', {name: 'Request failed view'}).click();
      await waitForCalls(3);
      calls[2].resolve({isError: true, content: [{type: 'text', text: 'Tool failed'}]});
      await page.getByRole('button', {name: 'Try unapproved tool'}).click();
      await page.waitForFunction(() => window.fixture.outbound.filter(({message}) => message.error).length === 3);
      assert.deepEqual(resultsReturned, ['newer', 'older', 'failed']);
      assert.deepEqual(decisions.map(({name, surfaceId}) => [name, surfaceId]), [
        ['readMode', 'bench'], ['readMode', 'bench'], ['readMode', 'bench'], ['unapprovedMcpTool', 'bench'],
      ]);
      assert.equal(await page.getByText('Tool result: older', {exact: true}).count(), 0);
      assert.equal(await page.getByText('Server status: older', {exact: true}).count(), 0);
      await page.getByText('Tool result: newer', {exact: true}).waitFor();
      await page.getByText('Server status: newer', {exact: true}).waitFor();
      const outbound = await page.evaluate(() => window.fixture.outbound);
      assert.equal(outbound.length, 3);
      for (const {message, metadata} of outbound) assertWireMessage(message, metadata);
      await page.close();
    }, process.env.PROYECCION_BROWSER_PROJECT);
  } finally {
    await client.close();
    await server.close();
  }
});

test('MCP linked layouts and app payloads stay in the renderer that called the tool', {timeout: 30000}, async () => {
  const server = new McpServer({name: 'fixture-linked-layouts', version: '1.0.0'});
  const client = new Client({name: 'test-renderer-host', version: '1.0.0'});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const declared = 'a2ui://detail/declared';
  const selected = 'a2ui://detail/selected';
  const app = 'ui://detail/sample';
  const denied = 'a2ui://detail/denied';
  const appMimeType = 'text/html;profile=mcp-app';
  const reads = [];
  const registerLayout = (uri, surfaceId) => {
    server.registerResource(surfaceId, uri, {mimeType}, async () => {
      reads.push(uri);
      return {contents: [resource([{version: '1.0', createSurface: {
        surfaceId, catalogId: basicCatalog.id, dataModel: {title: 'Layout default'},
        components: [{id: 'root', component: 'Text', text: {'@path': '/title'}}],
      }}], uri)]};
    });
  };
  registerLayout(declared, 'detail');
  registerLayout(selected, 'alternate');
  registerLayout(denied, 'forbidden');
  server.registerResource('app', app, {mimeType: appMimeType}, async () => {
    reads.push(app);
    return {contents: [{uri: app, mimeType: appMimeType,
      blob: Buffer.from('<p>Linked app</p>').toString('base64'), _meta: {ui: {csp: {connectDomains: []}}},
    }]};
  });
  server.registerTool('openPanel', {
    inputSchema: {label: z.string(), alternate: z.boolean()},
    _meta: {ui: {resourceUri: declared}},
  }, async ({label, alternate}) => {
    const surfaceId = alternate ? 'alternate' : 'detail';
    return {
      content: [
        {type: 'resource', resource: resource([{version: '1.0', updateDataModel: {
          surfaceId, path: '/title', value: label,
        }}])},
        ...(alternate ? [
          {type: 'resource_link', uri: app, name: 'linked app', mimeType: appMimeType},
          {type: 'resource_link', uri: denied, name: 'assistant link', annotations: {audience: ['assistant']}},
        ] : []),
      ],
      ...(alternate ? {_meta: {ui: {resourceUri: [selected, denied]}}} : {}),
    };
  });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    await withBrowser(async (browser, origin) => {
      const page = await browser.newPage();
      page.setDefaultTimeout(5000);
      const approvals = [];
      await page.exposeFunction('listMcp', params => client.listTools(params));
      await page.exposeFunction('readMcp', params => client.readResource(params));
      await page.exposeFunction('callMcp', params => client.callTool(params));
      await page.exposeFunction('approveMcpResource', request => {
        approvals.push(request);
        return request.name === 'openPanel' && request.surfaceId === 'controller' && request.uri !== denied;
      });
      await page.goto(origin + '/test-support/fixture-host.html');
      const catalogId = await page.evaluate(async () => {
        const top = document.querySelector('#viewport');
        top.style.height = '50vh';
        const bottom = document.createElement('div');
        bottom.id = 'second';
        bottom.style.cssText = 'position: relative; height: 50vh';
        document.body.append(bottom);
        const {fixture} = window;
        const right = fixture.mount(undefined, bottom);
        window.renderers = [fixture.projection, right];
        const install = view => fixture.addDirectMcpTools(
          ({name}) => name === 'openPanel'
            ? {listTools: window.listMcp, readResource: window.readMcp, callTool: window.callMcp} : undefined,
          {view, authorizeResource: window.approveMcpResource});
        const [id] = await Promise.all(window.renderers.map(install));
        return id;
      });
      const text = (id, value) => ({id, component: 'Text', text: value});
      const button = (id, label, alternate) => ({id, component: 'Button', child: id + '_label',
        action: {functionCall: {'@call': 'callMcpTool', catalogId,
          args: {name: 'openPanel', arguments: {label, alternate}, targetDataPath: '/output'}}}});
      const controller = side => ({version: '1.0', createSurface: {
        surfaceId: 'controller', catalogId: basicCatalog.id,
        components: [
          {id: 'root', component: 'Column', children: ['open', 'alternate', 'html']},
          button('open', 'Detail for ' + side, false), text('open_label', 'Open ' + side),
          button('alternate', 'Alternate for ' + side, true), text('alternate_label', 'Switch ' + side),
          text('html', {'@path': '/output/html'}),
        ],
      }});
      await page.evaluate(envelopes => envelopes.forEach((envelope, i) => window.renderers[i].receive(envelope)),
        [controller('left'), controller('right')]);
      const left = page.locator('#viewport');
      const right = page.locator('#second');
      await left.getByRole('button', {name: 'Open left'}).click();
      await left.getByText('Detail for left', {exact: true}).waitFor();
      const original = await left.getByText('Detail for left', {exact: true}).elementHandle();
      assert.equal(await right.getByText('Detail for left', {exact: true}).count(), 0);
      await right.getByRole('button', {name: 'Open right'}).click();
      await right.getByText('Detail for right', {exact: true}).waitFor();
      await left.getByRole('button', {name: 'Switch left'}).press('Enter');
      await left.getByText('Alternate for left', {exact: true}).waitFor();
      await left.getByText('<p>Linked app</p>', {exact: true}).waitFor();
      assert.equal(await right.getByText('Alternate for left', {exact: true}).count(), 0);
      assert.equal(await right.getByText('<p>Linked app</p>', {exact: true}).count(), 0);
      await left.getByRole('button', {name: 'Open left'}).press('Enter');
      await page.waitForFunction(() => !document.querySelector('#viewport').textContent.includes('<p>Linked app</p>'));
      assert.equal(await left.getByText('Detail for left', {exact: true})
        .evaluate((element, previous) => element === previous, original), true);
      assert.deepEqual(reads, [declared, declared, selected, app, declared]);
      assert.deepEqual(approvals.map(({uri}) => uri), [declared, declared, selected, denied, app, declared]);
      assert.deepEqual(await page.evaluate(() => [window.fixture.outbound, window.fixture.failures]), [[], []]);
      await page.close();
    }, process.env.PROYECCION_BROWSER_PROJECT);
  } finally {
    await client.close();
    await server.close();
  }
});
