import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {parse} from 'yaml';
import {basicCatalog} from '../src/protocol.js';
import {withBrowser} from '../test-support/browser.js';
import {record} from '../test-support/conformance-manifest.js';
import {assertWireMessage} from '../test-support/wire-check.js';

const suite = 'core/actions.yaml';
const entries = parse(readFileSync(new URL('./fixtures/a2ui-v1/actions.yaml', import.meta.url), 'utf8'));
const legacy = new Set([
  'test_action_event_with_data_binding',
  'test_action_event_with_relative_scope',
  'test_action_direct_name_shorthand',
]);

async function mountAction(page, {surfaceId, sourceComponentId, scope, dataModel, actionPayload}) {
  const components = [
    {id: 'root', component: 'Column', children: [sourceComponentId, 'companion']},
    {id: sourceComponentId, component: 'Button', child: 'label', action: actionPayload},
    {id: 'label', component: 'Text', text: scope ? {'@path': 'title'} : 'Run action'},
    {id: 'companion', component: 'Text', text: 'Surface still available'},
  ];
  if (scope) {
    const [, collection] = scope.split('/');
    components[0].children = ['rows', 'companion'];
    components.push({id: 'rows', component: 'Column', children: {
      path: '/' + collection, componentId: sourceComponentId,
    }});
  }
  await page.evaluate(createSurface => window.fixture.projection.receive({version: '1.0', createSurface}),
    {surfaceId, catalogId: basicCatalog.id, dataModel: dataModel ?? {}, components});
}

function checkEvent(action, entry) {
  const {timestampIso8601, ...expected} = entry.expectDispatched;
  if (expected.metadata === null) delete expected.metadata;
  const {timestamp, ...fields} = action;
  assert.ok(Number.isFinite(Date.parse(timestamp)));
  assert.deepEqual(fields, {
    context: {},
    surfaceId: entry.surfaceId,
    sourceComponentId: entry.sourceComponentId,
    ...expected,
  });
}

test('pinned A2UI actions through mounted Three.js controls', {timeout: 60000}, async t => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    page.setDefaultTimeout(6000);
    try {
      await page.goto(origin + '/test-support/fixture-host.html');
      await page.evaluate(() => {
        window.fixture.configure({increment: true, failAction: true, secondary: []});
        window.fixture.opened = [];
        window.open = url => { window.fixture.opened.push({url, active: navigator.userActivation.isActive}); };
      });
      for (const raw of entries) {
        if (legacy.has(raw.name)) {
          record(suite, raw.name, 'skipped', 'Uses pre-1.0 binding directives or the legacy direct action shorthand.');
          continue;
        }
        await t.test(raw.name, async () => {
          const entry = {surfaceId: 'main_surface', sourceComponentId: 'action_btn', ...raw};
          const badPayload = entry.expectError?.code === 'INVALID_ACTION';
          try {
            await mountAction(page, entry);
            if (!badPayload) {
              const button = page.getByRole('button', {name: entry.scope ? entry.dataModel.items[1].title : 'Run action'});
              if (entry.metadata) {
                const dispatch = metadata => page.evaluate(async metadata => {
                  const root = document.querySelector('a2ui-surface').rootNode;
                  const [node] = window.fixture.props(root).children;
                  await window.fixture.props(node).action({metadata});
                }, metadata);
                if (entry.expectError?.category) await assert.rejects(dispatch(entry.metadata), /UAX #31/);
                else await dispatch(entry.metadata);
              } else if (entry.userActivation === false) {
                await button.evaluate(element => element.click());
              } else {
                await button.click();
              }
              await page.getByText('Surface still available').waitFor();
            }
            const {sent, opened, failures, dataModel} = await page.evaluate(() => ({
              sent: window.fixture.outbound.splice(0),
              opened: window.fixture.opened.splice(0),
              failures: window.fixture.failures.splice(0),
              dataModel: document.querySelector('a2ui-surface')?.surface?.dataModel.get('/'),
            }));
            assert.deepEqual(failures, []);
            assert.deepEqual(opened, entry.userActivation === true
              ? [{url: 'https://example.com/', active: true}] : []);
            for (const {message, metadata} of sent) assertWireMessage(message, metadata);
            if (entry.expectDispatched) {
              assert.equal(sent.length, 1);
              checkEvent(sent[0].message.action, entry);
            } else if (entry.expectError && !entry.expectError.category) {
              assert.equal(sent.length, 1, JSON.stringify(sent));
              const {error} = sent[0].message;
              assert.equal(error.surfaceId, entry.surfaceId);
              assert.equal(error.code, badPayload ? 'VALIDATION_FAILED'
                : entry.expectError.code ?? 'EXPRESSION_ERROR');
              if (entry.expectError.message) assert.ok(error.message.includes(entry.expectError.message));
              if (badPayload) {
                assert.match(error.path, /^\/components\/1\/action(?:\/|$)/);
                assert.equal(await page.getByRole('button', {name: 'Run action'}).count(), 0);
              }
            } else {
              assert.deepEqual(sent, []);
            }
            if (entry.expectDataModel) assert.deepEqual(dataModel, entry.expectDataModel);
            if (badPayload) {
              record(suite, raw.name, 'skipped', 'Malformed wire input fails ingress validation before a control can dispatch it.');
            } else {
              record(suite, raw.name, 'passed');
            }
          } catch (error) {
            record(suite, raw.name, 'failed', String(error.message).slice(0, 1400));
            throw error;
          } finally {
            await page.evaluate(surfaceId => {
              if (document.querySelector('a2ui-surface')) {
                window.fixture.projection.receive({version: '1.0', deleteSurface: {surfaceId}});
              }
            }, entry.surfaceId);
            await page.locator('a2ui-surface').waitFor({state: 'detached'});
          }
        });
      }
      await t.test('a resolved user message must remain a string for each new action', async () => {
        const entry = {
          surfaceId: 'feedback', sourceComponentId: 'submit_btn',
          dataModel: {message: 'First feedback'},
          actionPayload: {event: {
            name: 'feedback', userMessage: {'@path': '/message'}, context: {origin: 'projection'},
          }},
        };
        await mountAction(page, entry);
        const button = page.getByRole('button', {name: 'Run action'});
        const update = value => page.evaluate(value => window.fixture.projection.receive({
          version: '1.0', updateDataModel: {surfaceId: 'feedback', path: '/message', value},
        }), value);
        const take = async () => {
          const items = await page.evaluate(() => window.fixture.outbound.splice(0));
          assert.equal(items.length, 1);
          const [item] = items;
          assertWireMessage(item.message, item.metadata);
          return item.message;
        };
        await button.click();
        checkEvent((await take()).action, {...entry, expectDispatched: {
          name: 'feedback', userMessage: 'First feedback', context: {origin: 'projection'},
        }});
        await update(42);
        await button.click();
        const diagnostic = await take();
        assert.equal(diagnostic.error.code, 'INVALID_ACTION');
        assert.equal(diagnostic.error.surfaceId, entry.surfaceId);
        await update('Revised feedback');
        await button.click();
        checkEvent((await take()).action, {...entry, expectDispatched: {
          name: 'feedback', userMessage: 'Revised feedback', context: {origin: 'projection'},
        }});
        assert.deepEqual(await page.evaluate(() => window.fixture.failures), []);
      });
    } finally {
      await page.close();
    }
  });
});
