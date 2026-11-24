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
    replacement.send(JSON.stringify([snapshot('Second session', 4)]));
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
  });
});
