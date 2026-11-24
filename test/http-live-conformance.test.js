import assert from 'node:assert/strict';
import test from 'node:test';
import {basicCatalog} from '../src/protocol.js';
import {withBrowser} from '../test-support/browser.js';
import {assertWireMessage} from '../test-support/wire-check.js';

const snapshot = (title, revision) => ({version: '1.0', createSurface: {
  surfaceId: 'bench', catalogId: basicCatalog.id, dataModel: {title, revision},
  components: [
    {id: 'root', component: 'Column', children: ['field', 'apply']},
    {id: 'field', component: 'TextField', label: 'Selection', value: {'@path': '/title'}},
    {id: 'apply', component: 'Button', child: 'label', action: {event: {name: 'apply', context: {
      title: {'@path': '/title'}, revision: {'@path': '/revision'},
    }}}},
    {id: 'label', component: 'Text', text: 'Apply selection'},
  ],
}});
const update = (title, revision) => ({version: '1.0', updateDataModel: {
  surfaceId: 'bench', path: '/', value: {title, revision},
}});

test('HTTP receipts and the live WebSocket preserve revisioned actions across a reconnect', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    const requests = [];
    const sockets = [];
    await page.routeWebSocket('**/fixture-live', socket => sockets.shift()(socket));
    await page.route('**/fixture-action', route => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({
        status: requests.length === 1 ? 409 : 200,
        json: {messages: [update('Receipt is not the live state', -1)]},
      });
    });
    await page.goto(origin + '/test-support/fixture-host.html');
    const waitForSocket = () => new Promise(resolve => sockets.push(resolve));
    const first = waitForSocket();
    await page.evaluate(() => {
      window.receipts = [];
      const stream = new URL('/fixture-live', location.href);
      stream.protocol = 'ws:';
      window.binding = window.fixture.httpLive({
        streamUrl: stream, actionUrl: '/fixture-action',
        onActionReceipt: receipt => window.receipts.push(receipt.status),
        onTransportError: error => window.fixture.failures.push(error.message),
      });
      window.binding.connect();
    });
    const socket = await first;
    socket.send('{');
    socket.send(JSON.stringify([snapshot('First state', 1)]));
    const field = page.getByRole('textbox', {name: 'Selection'});
    await field.waitFor({timeout: 5000});
    assert.equal(await field.inputValue(), 'First state');
    await field.fill('Draft');
    await page.getByRole('button', {name: 'Apply selection'}).click();
    await page.waitForFunction(() => window.receipts.length === 1);
    assert.equal(requests.length, 1);
    assertWireMessage(requests[0]);
    assert.deepEqual(requests[0].action.context, {title: 'Draft', revision: 1});
    assert.equal(await field.inputValue(), 'Draft');

    socket.send(JSON.stringify([update('Committed live state', 2)]));
    await page.waitForFunction(() => document.querySelector('a2ui-surface input').value === 'Committed live state');
    const previous = await field.elementHandle();
    const next = waitForSocket();
    await page.evaluate(() => window.binding.connect());
    const replacement = await next;
    replacement.send(JSON.stringify([update('Invalid first frame', 99)]));
    await page.waitForFunction(() => window.fixture.failures.length === 2);
    assert.equal(await field.inputValue(), 'Committed live state');
    const rejected = snapshot('Rejected replacement', 99);
    rejected.createSurface.catalogId = 'fixture-unregistered';
    replacement.send(JSON.stringify([rejected]));
    await page.waitForFunction(() =>
      window.fixture.failures.includes('The first A2UI frame did not create its surface'));
    assert.equal(await field.count(), 1);
    assert.equal(await field.inputValue(), 'Committed live state');
    assert.equal(await field.evaluate((element, before) => element === before, previous), true);
    await page.getByRole('button', {name: 'Apply selection'}).click();
    await page.waitForFunction(() => window.fixture.failures.includes('The projection connection is closed'));
    assert.deepEqual(await page.evaluate(() => window.receipts), [409]);
    assert.equal(requests.length, 1);
    replacement.send(JSON.stringify([snapshot('Reconnected', 3), update('Second session', 4)]));
    await page.waitForFunction(() => document.querySelector('a2ui-surface input').value === 'Second session');
    assert.equal(await field.evaluate((element, before) => element === before, previous), false);
    assert.equal(await page.locator('a2ui-surface').count(), 1);
    assert.equal(requests.length, 1);
    await page.getByRole('button', {name: 'Apply selection'}).click();
    await page.waitForFunction(() => window.receipts.length === 2);
    assert.equal(requests.length, 2);
    assertWireMessage(requests[1]);
    assert.deepEqual(requests[1].action.context, {title: 'Second session', revision: 4});
    assert.deepEqual(await page.evaluate(() => window.receipts), [409, 200]);
    await page.evaluate(() => window.binding.dispose());
    assert.equal(await field.count(), 0);
    await page.close();
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('a lost HTTP response leaves a correlated uncertain action and is reconciled by the next snapshot', {timeout: 15000}, async () => {
  const received = [];
  let accept;
  const accepted = new Promise(resolve => { accept = resolve; });
  const app = {
    name: 'fixture-uncertain-action',
    configureServer(server) {
      server.middlewares.use('/fixture-uncertain-action', async (request, response) => {
        let body = '';
        for await (const chunk of request.setEncoding('utf8')) body += chunk;
        const envelope = JSON.parse(body);
        received.push(envelope);
        if (received.length === 1) {
          accept({title: envelope.action.context.title, revision: envelope.action.context.revision + 1});
        } else {
          response.writeHead(200).end();
        }
      });
    },
  };
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    const sockets = [];
    await page.routeWebSocket('**/fixture-live', socket => sockets.shift()(socket));
    const nextSocket = () => new Promise(resolve => sockets.push(resolve));
    try {
      await page.goto(origin + '/test-support/fixture-host.html');
      const opened = nextSocket();
      await page.evaluate(() => {
        window.receipts = [];
        window.actionErrors = [];
        const stream = new URL('/fixture-live', location.href);
        stream.protocol = 'ws:';
        window.binding = window.fixture.httpLive({
          streamUrl: stream, actionUrl: '/fixture-uncertain-action',
          onActionReceipt: receipt => window.receipts.push(receipt),
          onTransportError: error => window.actionErrors.push({code: error.code, action: error.action}),
        });
        window.binding.connect();
      });
      const socket = await opened;
      socket.send(JSON.stringify([snapshot('Initial value', 1)]));
      const field = page.getByRole('textbox', {name: 'Selection'});
      const button = page.getByRole('button', {name: 'Apply selection'});
      await field.fill('Accepted without a receipt', {timeout: 4000});
      const original = await field.elementHandle();
      await button.click({timeout: 4000});
      const confirmed = await accepted;
      await socket.close({code: 1011, reason: 'Fixture interrupted the stream'});
      await page.waitForFunction(() => window.actionErrors.length || window.fixture.failures.length, undefined, {timeout: 4000});
      assert.deepEqual(await page.evaluate(() => window.fixture.failures), []);
      assert.deepEqual(await page.evaluate(() => window.actionErrors), [
        {code: 'ACTION_OUTCOME_UNKNOWN', action: received[0].action},
      ]);
      assert.deepEqual(await page.evaluate(() => window.receipts), []);
      const reconnected = nextSocket();
      await page.evaluate(() => window.binding.connect());
      (await reconnected).send(JSON.stringify([snapshot(confirmed.title, confirmed.revision)]));
      await page.waitForFunction(before => {
        const current = document.querySelector('input');
        return current !== before && current?.value === 'Accepted without a receipt';
      }, original, {timeout: 4000});
      assert.equal(received.length, 1);
      assertWireMessage(received[0]);
      await field.fill('New action');
      await button.click();
      await page.waitForFunction(() => window.receipts.length === 1, undefined, {timeout: 4000});
      assert.equal(received.length, 2);
      assert.deepEqual(received[1].action.context, {title: 'New action', revision: 2});
      assert.deepEqual(await page.evaluate(() => window.receipts), [{status: 200, action: received[1].action}]);
      await page.evaluate(() => window.binding.dispose());
    } finally {
      await page.close();
    }
  }, process.env.PROYECCION_BROWSER_PROJECT, [app]);
});
