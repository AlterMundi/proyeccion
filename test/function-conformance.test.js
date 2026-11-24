import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {Catalog, DataContext, NodeResolver, getValue, isSignal} from '@a2ui/web_core';
import {parse} from 'yaml';
import {loadCatalog} from '../src/catalog.js';
import {basicCatalog, createProtocol} from '../src/protocol.js';
import {withBrowser} from '../test-support/browser.js';
import {record} from '../test-support/conformance-manifest.js';
import {assertWireMessage} from '../test-support/wire-check.js';

const suite = 'core/functions.yaml';
const fixtures = new URL('./fixtures/a2ui-v1/', import.meta.url);
const entries = parse(readFileSync(new URL('functions.yaml', fixtures), 'utf8'));
const validationCodes = {CatalogError: 'CATALOG_ERROR', ExpressionError: 'EXPRESSION_ERROR',
  ValidationError: 'VALIDATION_FAILED'};
const obsoleteArguments = new Set([
  'test_evaluate_function_length_array_count_valid',
  'test_evaluate_function_length_array_count_too_short',
  'test_evaluate_function_numeric_valid_string',
  'test_evaluate_function_numeric_unparseable_string',
]);

function assertDiagnostic(sent, expected) {
  assert.equal(sent.length, 1, JSON.stringify(sent));
  const [message] = sent;
  assertWireMessage(message);
  assert.equal(message.error.surfaceId, 'main');
  assert.equal(message.error.code, validationCodes[expected.category]);
  if (expected.message) assert.ok(message.error.message.includes(expected.message), message.error.message);
}

async function verifyBindings(entry, transport, surface, sent) {
  for (const step of entry.steps) {
    for (const message of step.payload) await transport.receive(message);
    if (step.expectError) {
      assertDiagnostic(sent, step.expectError);
      assert.equal(sent[0].error.path, '/components/0/text/args/value');
      assert.equal(surface()?.disposed ?? true, true);
      return;
    }
  }
  const resolver = new NodeResolver(surface());
  try {
    const expected = entry.expect.surfaces.main.components;
    const actual = {};
    const visit = node => {
      const props = getValue(node.props);
      if (props.text) actual[node.componentId] = {component: node.type, text: props.text.value};
      for (const child of props.children ?? []) visit(child);
    };
    visit(getValue(resolver.rootNode));
    assert.deepEqual(actual, expected);
    assert.deepEqual(sent, []);
  } finally {
    resolver.dispose();
  }
}

async function verifyFunction(entry, transport, surface, sent) {
  await transport.receive({version: '1.0', createSurface: {
    surfaceId: 'main',
    dataModel: entry.dataModel ?? {},
    ...(entry.surface ?? {catalogId: basicCatalog.id}),
  }});
  const context = new DataContext(surface(), '/');
  const raw = await context.resolveDynamicValue({
    '@call': entry.function,
    args: entry.args,
    ...(entry.catalogId && {catalogId: entry.catalogId}),
  });
  const actual = isSignal(raw) ? getValue(raw) : raw;
  if (obsoleteArguments.has(entry.name)) {
    assertDiagnostic(sent, {category: 'ExpressionError', message: `Validation failed for function '${entry.function}'`});
    assert.equal(actual, undefined);
    return 'The 1.0 Basic Catalog only accepts strings for length and numbers for numeric.';
  }
  if (entry.expectError) {
    assertDiagnostic(sent, entry.expectError);
    return;
  }
  assert.deepEqual(sent, []);
  const legacyBoolean = basicCatalog.functions.get(entry.function)?.returnType === 'validationResult'
    && typeof entry.expect === 'boolean';
  if (legacyBoolean || typeof entry.expect?.valid === 'boolean') {
    assert.equal(actual?.valid, legacyBoolean ? entry.expect : entry.expect.valid);
    if (legacyBoolean) return 'The unversioned fixture expects a boolean. The 1.0 ValidationResult agrees on valid.';
    return;
  }
  assert.deepEqual(actual, entry.expect);
}

for (const entry of entries) {
  if (entry.protocolVersion === 'v0.9') {
    record(suite, entry.name, 'skipped', 'The renderer only accepts A2UI 1.0.');
    continue;
  }
  if (entry.function === 'openUrl') continue;
  test(entry.name, async () => {
    const catalogs = [basicCatalog, basicCatalog.copyWith({catalogId: 'basic'})];
    const sent = [];
    const faults = [];
    let model;
    let transport;
    try {
      for (const path of entry.catalogPaths ?? []) {
        if (path.startsWith('conformance/test_data/catalogs/')) {
          catalogs.push(loadCatalog(JSON.parse(readFileSync(new URL('catalogs/' + path.split('/').at(-1), fixtures)))));
        }
      }
      if (entry.catalogPaths?.includes('catalogs/basic/v0_9/catalog.json')) {
        const legacy = new Catalog(entry.catalogId, 'v0.9', [], []);
        assert.throws(() => createProtocol({catalogs: [...catalogs, legacy], send() {}}), /1\.0/);
      }
      transport = createProtocol({catalogs, send: message => { sent.push(message); },
        onSurfaceCreated: surface => { model = surface; },
        onTransportError: error => { faults.push(error.message); },
      });
      const verify = entry.steps ? verifyBindings : verifyFunction;
      const exclusion = await verify(entry, transport, () => model, sent);
      assert.deepEqual(faults, []);
      record(suite, entry.name, exclusion ? 'skipped' : 'passed', exclusion);
    } catch (error) {
      record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
      throw error;
    } finally {
      transport?.dispose();
    }
  });
}

test('Basic Catalog openUrl cases with trusted Chromium activation', {timeout: 30000}, async t => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    try {
      await page.goto(origin + '/test-support/fixture-host.html');
      await page.evaluate(() => {
        window.fixture.opened = [];
        window.open = url => { window.fixture.opened.push({url, active: navigator.userActivation.isActive}); };
      });
      for (const entry of entries.filter(entry => entry.function === 'openUrl')) {
        await t.test(entry.name, async () => {
          try {
            await page.evaluate(({catalogId, args}) => window.fixture.projection.receive({
              version: '1.0', createSurface: {surfaceId: 'main', catalogId, components: [
                {id: 'root', component: 'Button', child: 'label',
                  action: {functionCall: {'@call': 'openUrl', args}}},
                {id: 'label', component: 'Text', text: 'Open link'},
              ]},
            }), {catalogId: basicCatalog.id, args: entry.args});
            await page.getByRole('button', {name: 'Open link'}).click();
            const {messages, opened, faults} = await page.evaluate(() => ({
              messages: window.fixture.outbound.splice(0).map(row => row.message),
              opened: window.fixture.opened.splice(0),
              faults: window.fixture.failures,
            }));
            assert.deepEqual(faults, []);
            if (entry.expectError) {
              assertDiagnostic(messages, {...entry.expectError, message: 'Unsupported URL scheme'});
              assert.deepEqual(opened, []);
            } else {
              assert.deepEqual(messages, []);
              assert.deepEqual(opened, [{url: new URL(entry.args.url).href, active: true}]);
            }
            record(suite, entry.name, 'passed');
          } catch (error) {
            record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
            throw error;
          } finally {
            await page.evaluate(() => window.fixture.projection.receive({
              version: '1.0', deleteSurface: {surfaceId: 'main'},
            }));
            await page.locator('a2ui-surface').waitFor({state: 'detached'});
          }
        });
      }
    } finally {
      await page.close();
    }
  });
});
