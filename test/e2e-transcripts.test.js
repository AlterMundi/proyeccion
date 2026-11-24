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
