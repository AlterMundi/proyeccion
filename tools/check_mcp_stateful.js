import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {withBrowser} from '../test-support/browser.js';
import {assertWireCapabilities, assertWireMessage} from '../test-support/wire-check.js';

const python = process.env.PROYECCION_MCP_PYTHON ?? 'python3';
const server = fileURLToPath(new URL('../test/fixtures/mcp-stateful-server.py', import.meta.url));

test('Python MCP uses the initialization catalog to render an interactive A2UI panel', {timeout: 30000}, async () => {
  await withBrowser(async (browser, origin) => {
    for (const advertise of [false, true]) {
      const page = await browser.newPage();
      const client = new Client({name: 'proyeccion-stateful-example', version: '1.0.0'});
      const calls = [];
      const transport = new StdioClientTransport({command: python, args: [server]});
      try {
        await page.goto(origin + '/test-support/fixture-host.html');
        await page.exposeFunction('callStatefulMcp', async params => {
          calls.push(params);
          return client.callTool(params);
        });
        const capabilities = await page.evaluate(() => {
          const {view, binding} = window.fixture.mcpTransport(
            {callTool: window.callStatefulMcp}, {perCallCapabilities: false});
          window.statefulBinding = binding;
          return view.capabilities();
        });
        assertWireCapabilities(capabilities);
        if (advertise) client.registerCapabilities({a2ui: {rendererCapabilities: capabilities}});
        await client.connect(transport);
        const result = await page.evaluate(() => window.statefulBinding.callTool('open_panel', {}));
        assert.equal(Boolean(result.isError), false, JSON.stringify(result.content));
        const button = page.getByRole('button', {name: 'Confirm panel'});
        if (advertise) {
          await page.getByText('Panel ready', {exact: true}).waitFor({timeout: 6000});
          await button.click();
          await page.getByText('Confirmed by the MCP server', {exact: true}).waitFor({timeout: 6000});
          assert.deepEqual(calls.map(call => call.name), ['open_panel', 'a2ui_action']);
          const action = calls[1];
          assertWireMessage({version: '1.0', action: action.arguments}, action._meta);
          assert.deepEqual(action._meta.a2uiRendererDataModel.surfaces.mcp_stateful,
            {status: 'Panel ready', revision: 1});
        } else {
          assert.equal(await button.count(), 0);
          assert.deepEqual(result.content, [{type: 'text', text: 'This session cannot display the panel.'}]);
          assert.deepEqual(calls.map(call => call.name), ['open_panel']);
        }
        assert.ok(calls.every(call => call._meta?.a2ui === undefined));
        assert.deepEqual(await page.evaluate(() => window.fixture.failures), []);
      } finally {
        await page.close();
        await client.close();
      }
    }
  }, process.env.PROYECCION_BROWSER_PROJECT);
});
