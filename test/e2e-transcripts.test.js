import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import test from 'node:test';
import {parse} from 'yaml';
import {assertViewTree, matchOutput, userInput} from '../test-support/adapter-fixture.js';
import {withBrowser} from '../test-support/browser.js';
import {record} from '../test-support/conformance-manifest.js';
import {assertWireMessage} from '../test-support/wire-check.js';

const fixtures = new URL('./fixtures/a2ui-v1/e2e/', import.meta.url);

test('pinned A2UI 1.0 golden transcripts through the browser renderer', {timeout: 25000}, async t => {
  await withBrowser(async (browser, origin) => {
    for (const file of readdirSync(fixtures).filter(name => name.endsWith('.yaml')).sort()) {
      for (const scenario of parse(readFileSync(new URL(file, fixtures), 'utf8'))) {
        await t.test(scenario.name, async () => {
          const page = await browser.newPage({timezoneId: 'UTC'});
          page.setDefaultTimeout(5000);
          try {
            assert.equal(scenario.protocolVersion, '1.0');
            assert.equal(scenario.action, 'e2e_scenario');
            assert.deepEqual(scenario.catalogPaths, ['catalogs/basic/v1/catalog.json']);
            await page.goto(origin + '/test-support/fixture-host.html');
            for (const turn of scenario.turns) {
              const messages = turn.expectWire.flatMap(part => part.a2ui ?? []);
              await page.evaluate(messages => window.fixture.projection.receiveBatch(messages), messages);
              for (const [surfaceId, tree] of Object.entries(turn.expectViewTree ?? {})) {
                if (tree === null) {
                  assert.equal(await page.evaluate(id => window.fixture.projection.hasSurface(id), surfaceId), false);
                  assert.equal(await page.locator('a2ui-surface').count(), 0);
                } else {
                  await page.waitForFunction(id => [...document.querySelectorAll('a2ui-surface')]
                    .some(view => view.surface?.id === id && view.rootNode), surfaceId);
                  await assertViewTree(page, tree, surfaceId);
                }
              }
              for (const step of turn.uiOps ?? []) {
                assert.equal(await page.evaluate(id => window.fixture.projection.hasSurface(id), step.surfaceId), true);
                if (step.op === 'user_input') {
                  await userInput(page, step);
                } else if (step.op === 'user_gesture') {
                  await page.evaluate(() => window.fixture.markInputs());
                  await page.locator(`[data-fixture-component="${step.targetNode}"]`).first().getByRole('button').click();
                } else {
                  assert.fail('Unsupported transcript operation: ' + step.op);
                }
              }
              for (const [surfaceId, expected] of Object.entries(turn.expectDataModel ?? {})) {
                const data = await page.evaluate(id => [...document.querySelectorAll('a2ui-surface')]
                  .find(view => view.surface?.id === id)?.surface.dataModel.get('/'), surfaceId);
                assert.deepEqual(data, expected);
              }
              const {outbound, failures} = await page.evaluate(() => ({
                outbound: window.fixture.outbound.splice(0), failures: window.fixture.failures.splice(0),
              }));
              assert.deepEqual(failures, []);
              for (const {message, metadata} of outbound) assertWireMessage(message, metadata);
              const actual = outbound.map(row => row.message);
              assert.deepEqual(actual, matchOutput(actual, turn.expectOutbound ?? []));
              if (turn.expectErrors) assert.deepEqual(actual.flatMap(envelope => envelope.error ?? []), turn.expectErrors);
            }
            record('e2e/' + file, scenario.name, 'passed');
          } catch (error) {
            record('e2e/' + file, scenario.name, 'failed', error.message);
            throw error;
          } finally {
            await page.close();
          }
        });
      }
    }
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('a projection without a return channel renders agent updates and can run local actions', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    try {
      await page.goto(origin + '/test-support/fixture-host.html');
      await page.evaluate(() => {
        const {fixture} = window;
        fixture.configure({receiveOnly: true, increment: true, secondary: []});
        fixture.projection.receive({version: '1.0', createSurface: {
          surfaceId: 'display',
          catalogId: fixture.projection.capabilities()['1.0'].supportedCatalogIds[0],
          dataModel: {count: 2},
          components: [
            {id: 'root', component: 'Column', children: ['count', 'increase', 'notify']},
            {id: 'count', component: 'Text', text: {'@call': 'formatString', args: {value: 'Count: ${/count}'}}},
            {id: 'increase', component: 'Button', child: 'increaseLabel', action: {functionCall: {
              '@call': 'incrementCounter', args: {path: '/count', step: 1},
            }}},
            {id: 'increaseLabel', component: 'Text', text: 'Increase locally'},
            {id: 'notify', component: 'Button', child: 'notifyLabel', action: {event: {name: 'notify'}}},
            {id: 'notifyLabel', component: 'Text', text: 'Notify agent'},
          ],
        }});
      });
      await page.getByText('Count: 2', {exact: true}).waitFor();
      await page.getByRole('button', {name: 'Increase locally'}).click();
      await page.getByText('Count: 3', {exact: true}).waitFor();
      await page.getByRole('button', {name: 'Notify agent'}).click();
      await page.evaluate(() => window.fixture.projection.receive({version: '1.0', updateDataModel: {
        surfaceId: 'display', path: '/count', value: 4,
      }}));
      await page.getByText('Count: 4', {exact: true}).waitFor();
      assert.deepEqual(await page.evaluate(() => [window.fixture.outbound, window.fixture.failures]), [[], []]);
    } finally {
      await page.close();
    }
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('cancelling one live surface preserves another surface and rejects the late reply', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    try {
      await page.goto(origin + '/test-support/fixture-host.html');
      await page.evaluate(() => {
        const {fixture} = window;
        const [catalogId] = fixture.projection.capabilities()['1.0'].supportedCatalogIds;
        for (const id of ['primary', 'other']) {
          fixture.projection.receive({version: '1.0', createSurface: {
            surfaceId: id, catalogId, dataModel: {account: id},
            components: [{id: 'root', component: 'Text', text: {
              '@call': 'lookupAccount', args: {accountId: {'@path': '/account'}},
            }}],
          }});
        }
      });
      await page.waitForFunction(() => window.fixture.outbound.length === 2);
      const outbound = await page.evaluate(() => window.fixture.outbound.map(row => row.message));
      assert.ok(outbound.every(message => message.callAgentFunction), JSON.stringify(outbound));
      const [cancelled, retained] = ['primary', 'other'].map(id =>
        outbound.find(message => message.callAgentFunction.surfaceId === id).callAgentFunction.functionCallId);
      await page.evaluate(() => {
        window.originalSurface = [...document.querySelectorAll('a2ui-surface')]
          .find(view => view.surface.id === 'primary');
        window.fixture.projection.cancelSurfaceCalls('primary');
      });
      const reply = (functionCallId, value) => page.evaluate(({functionCallId, value}) =>
        window.fixture.projection.receive({version: '1.0', agentFunctionResponse: {functionCallId, value}}),
      {functionCallId, value});
      await reply(cancelled, 'Cancelled answer');
      await reply(retained, 'Other answer');
      await page.getByText('Other answer', {exact: true}).waitFor();
      assert.equal(await page.getByText('Cancelled answer', {exact: true}).count(), 0);
      await page.evaluate(() => window.fixture.projection.receive({version: '1.0', updateDataModel: {
        surfaceId: 'primary', path: '/account', value: 'replacement',
      }}));
      await page.waitForFunction(() => window.fixture.outbound.length === 3);
      const next = await page.evaluate(() => window.fixture.outbound.at(-1).message.callAgentFunction);
      assert.equal(next.surfaceId, 'primary');
      assert.notEqual(next.functionCallId, cancelled);
      assert.deepEqual(next.callFunction.args, {accountId: 'replacement'});
      await reply(next.functionCallId, 'Replacement answer');
      await page.getByText('Replacement answer', {exact: true}).waitFor();
      assert.equal(await page.getByText('Other answer', {exact: true}).count(), 1);
      assert.deepEqual(await page.evaluate(() => ({
        sameSurface: window.originalSurface.isConnected && window.originalSurface.textContent.includes('Replacement answer'),
        errors: window.fixture.failures, outbound: window.fixture.outbound.length,
      })), {sameSurface: true, errors: [], outbound: 3});
    } finally {
      await page.close();
    }
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('strict topology checks leave the existing view intact and the next update can stream', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    const update = (components, options) => page.evaluate(({components, options}) =>
      window.fixture.projection.receiveBatch([{version: '1.0', updateComponents: {surfaceId: 'panel', components}}], options),
    {components, options});
    const text = (id, value) => ({id, component: 'Text', text: value});
    try {
      await page.goto(origin + '/test-support/fixture-host.html');
      await page.evaluate(() => {
        const {projection} = window.fixture;
        projection.receive({version: '1.0', createSurface: {
          surfaceId: 'panel', catalogId: projection.capabilities()['1.0'].supportedCatalogIds[0],
          components: [
            {id: 'root', component: 'Column', children: ['known']},
            {id: 'known', component: 'Text', text: 'Original'},
          ],
        }});
      });
      await page.getByText('Original', {exact: true}).waitFor();
      const mounted = await page.locator('a2ui-surface').elementHandle();
      const components = [{id: 'root', component: 'Column', children: ['known', 'later']}, text('known', 'Updated')];
      await update(components, {strictTopology: true});
      assert.equal(await page.getByText('Original', {exact: true}).count(), 1);
      assert.equal(await page.getByText('Updated', {exact: true}).count(), 0);
      const [failure] = await page.evaluate(() => window.fixture.outbound.splice(0));
      assertWireMessage(failure.message, failure.metadata);
      assert.equal(failure.message.error.code, 'INTEGRITY_ERROR', failure.message.error.message);
      assert.equal(failure.message.error.surfaceId, 'panel');
      await update(components);
      await update([text('later', 'Arrived later')], {strictTopology: true});
      await page.getByText('Arrived later', {exact: true}).waitFor();
      await page.getByText('Updated', {exact: true}).waitFor();
      assert.equal(await page.locator('a2ui-surface').evaluate((element, before) => element === before, mounted), true);
      assert.deepEqual(await page.evaluate(() => [window.fixture.outbound, window.fixture.failures]), [[], []]);
    } finally {
      await page.close();
    }
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('strict catalog checks can be enabled independently of complete topology', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    const update = (components, options) => page.evaluate(({components, options}) =>
      window.fixture.projection.receiveBatch([{version: '1.0', updateComponents: {surfaceId: 'panel', components}}], options),
    {components, options});
    const text = (id, value) => ({id, component: 'Text', text: value});
    try {
      await page.goto(origin + '/test-support/fixture-host.html');
      await page.evaluate(() => {
        const {projection} = window.fixture;
        projection.receive({version: '1.0', createSurface: {
          surfaceId: 'panel', catalogId: projection.capabilities()['1.0'].supportedCatalogIds[0],
        }});
      });
      await update([
        {id: 'root', component: 'Column', children: ['known', 'later']}, text('known', 'Original'),
      ], {strictCatalog: true});
      await page.getByText('Original', {exact: true}).waitFor();
      const change = [{id: 'later', component: 'UnknownWidget'}, text('known', 'Updated')];
      await update(change, {strictTopology: true, strictCatalog: true});
      assert.equal(await page.getByText('Original', {exact: true}).count(), 1);
      const outbound = await page.evaluate(() => window.fixture.outbound.splice(0));
      assert.equal(outbound.length, 1);
      const [{message, metadata}] = outbound;
      assertWireMessage(message, metadata);
      assert.equal(message.error.code, 'VALIDATION_FAILED');
      assert.equal(message.error.path, '/components/0/component');
      assert.equal(message.error.surfaceId, 'panel');
      assert.match(message.error.message, /UnknownWidget/);
      await update(change, {strictTopology: true});
      await page.getByText('Updated', {exact: true}).waitFor();
      const {fallback, failures} = await page.evaluate(() => ({
        fallback: window.fixture.outbound, failures: window.fixture.failures,
      }));
      assert.deepEqual(failures, []);
      assert.equal(fallback.length, 1);
      assertWireMessage(fallback[0].message, fallback[0].metadata);
      assert.equal(fallback[0].message.error.code, 'UNKNOWN_COMPONENT_TYPE');
      assert.equal(fallback[0].message.error.surfaceId, 'panel');
    } finally {
      await page.close();
    }
  }, process.env.PROYECCION_BROWSER_PROJECT);
});
