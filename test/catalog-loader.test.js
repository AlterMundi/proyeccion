import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {A2uiGenerator, CatalogConfig, DirectJsonFormatFactory, resolveCatalogs} from '@a2ui/agent';
import {Catalog} from '@a2ui/web_core';
import {PayloadValidator} from '@a2ui/web_core/validation';
import {parse} from 'yaml';
import {z} from 'zod';
import {loadCatalog} from '../src/catalog.js';
import {basicCatalog, createProtocol} from '../src/protocol.js';
import {withBrowser} from '../test-support/browser.js';
import {record} from '../test-support/conformance-manifest.js';
import {assertWireCapabilities, assertWireMessage} from '../test-support/wire-check.js';

const suite = 'core/catalog.yaml';
const fixture = file => readFileSync(new URL('./fixtures/a2ui-v1/' + file, import.meta.url), 'utf8');
const entries = parse(fixture('catalog.yaml'));
const documents = new Map([
  ['catalogs/basic/v1/catalog.json', 'catalog.json'],
  ['catalogs/mcp/v1/catalog.json', 'catalogs/mcp.json'],
  ['catalogs/vegachart/v1/catalog.json', 'catalogs/vegachart.json'],
  ['conformance/test_data/catalogs/component_metadata_catalog_v1_0.json', 'catalogs/component-metadata.json'],
  ['conformance/test_data/catalogs/component_metadata_invalid_key_catalog_v1_0.json', 'catalogs/component-metadata-invalid.json'],
  ['conformance/test_data/catalogs/function_metadata_catalog_v1_0.json', 'catalogs/function-metadata.json'],
  ['conformance/test_data/validation_schema/test_v10_basic_validation_schema.json', 'validation-schema/basic.json'],
]);

function assertLocalReferences(document) {
  let references = 0;
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (typeof value.$ref === 'string') {
      references++;
      assert.ok(value.$ref.startsWith('#/'), value.$ref);
      let target = document;
      for (const encodedKey of value.$ref.slice(2).split('/')) {
        const key = encodedKey.replaceAll('~1', '/').replaceAll('~0', '~');
        assert.ok(target && Object.hasOwn(target, key), value.$ref);
        target = target[key];
      }
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(document);
  assert.ok(references > 0);
}

function signatures(catalog) {
  const fields = ['returnType', 'allowedCallers', 'requiresUserActivation'];
  return Object.fromEntries([...catalog.functions].filter(([name]) => !name.startsWith('@')).map(([name, fn]) =>
    [name, Object.fromEntries(fields.map(field => [field, fn[field]]))]));
}

function shapes(catalog) {
  const fields = list => list.filter(key => key !== 'component' && key !== 'id').sort();
  return Object.fromEntries(Object.entries(catalog.validationSchema.components).map(([name, definition]) =>
    [name, {fields: fields(Object.keys(definition.properties ?? {})), required: fields(definition.required ?? [])}]));
}

for (const entry of entries) {
  const file = documents.get(entry.catalogPath);
  const document = file ? JSON.parse(fixture(file)) : entry.catalog;
  const version = entry.protocolVersion ?? document?.protocolVersion;
  const expectedFile = documents.get(entry.expectFile);
  if (version === '1.0' && ((entry.action === 'round_trip' && file)
      || (expectedFile && (entry.action === 'to_json' || entry.action === 'validation_schema')))) {
    test(entry.name, () => {
      try {
        if (entry.action === 'to_json') {
          assert.equal(entry.builtinCatalog, 'basic');
          assert.deepEqual(basicCatalog.toJson(), JSON.parse(fixture(expectedFile)));
        } else if (entry.action === 'round_trip') {
          const catalog = loadCatalog(document);
          assert.deepEqual(catalog.toJson(), document);
          const runtime = createProtocol({catalogs: [catalog], send: () => assert.fail('Unexpected delivery')});
          try {
            const capabilities = runtime.capabilities({
              agentCapabilities: {'1.0': {acceptsInlineCatalogs: true}}, inlineCatalogIds: [catalog.id],
            });
            assertWireCapabilities(capabilities);
            assert.deepEqual(capabilities['1.0'].inlineCatalogs, [document]);
          } finally {
            runtime.dispose();
          }
        } else {
          assert.deepEqual(loadCatalog(document).validationSchema, JSON.parse(fixture(expectedFile)));
        }
        record(suite, entry.name, 'passed');
      } catch (error) {
        record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
        throw error;
      }
    });
    continue;
  }
  if (entry.action !== 'from_json' || version !== '1.0') {
    const reason = (entry.action === 'from_json' || (version && version !== '1.0'))
      ? 'Outside the A2UI 1.0 catalog profile.'
      : entry.action === 'derive' ? 'Host catalog authoring utility, separate from ingesting and negotiating renderer catalogs.'
      : 'The case uses the noncanonical ComponentCommon wrapper at the component root.';
    record(suite, entry.name, 'skipped', reason);
    continue;
  }
  const illegalEnvelope = entry.name === 'test_v10_catalog_from_json_leaf_defs';
  test(illegalEnvelope ? entry.name + ' (canonical flat component)' : entry.name, t => {
    const raw = {...document, protocolVersion: version,
      ...(entry.catalogId ? {catalogId: entry.catalogId} : {}),
    };
    if (illegalEnvelope) {
      assert.throws(() => loadCatalog(raw), /SelectBox.*Checkable trait import/);
      const {allOf, ...outer} = raw.components.SelectBox;
      const [, local] = allOf;
      raw.components = {SelectBox: {...outer, ...local}};
    }
    const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('Catalog loading attempted a network request'));
    try {
      if (entry.expectError) {
        assert.throws(() => loadCatalog(raw), error => {
          const {category, message} = entry.expectError;
          assert.ok(['A2ui' + category, 'A2uiCatalogError'].includes(error.name), error.name);
          if (/uax31_invalid/.test(entry.name)) assert.match(error.message, /UAX #31/);
          if (message?.includes('UAX #31')) assert.match(error.message, /UAX #31/);
          else if (message) assert.ok(error.message.includes(message), error.message);
          return true;
        });
      } else {
        const catalog = loadCatalog(raw);
        const expected = entry.expect ?? {};
        assert.equal(catalog.protocolVersion, expected.protocolVersion ?? '1.0');
        if (expected.catalogId) assert.equal(catalog.id, expected.catalogId);
        for (const key of ['components', 'functions']) {
          const listed = expected[key];
          if (listed) {
            const names = Array.isArray(listed) ? listed : Object.keys(listed);
            assert.deepEqual([...catalog[key].keys()].sort(), [...names].sort());
            if (!Array.isArray(listed)) {
              const emitted = catalog.toJson()[key];
              for (const [name, fields] of Object.entries(listed)) {
                for (const [field, value] of Object.entries(fields)) {
                  assert.deepEqual(emitted[name][field], value, name + '.' + field);
                }
              }
            }
          }
        }
        if (expected.selfContained) assertLocalReferences(catalog.validationSchema);
        if (expected.matchesBuiltinCatalog) {
          assert.deepEqual(shapes(catalog), shapes(basicCatalog));
          assert.deepEqual(signatures(catalog), signatures(basicCatalog));
        }
        for (const [name, metadata] of Object.entries(expected.componentMetadata ?? {})) {
          assert.ok(catalog.components.has(name));
          assert.deepEqual(catalog.components.get(name).metadata ?? null, metadata);
        }
        const validator = new PayloadValidator(catalog, {allowUnknownElements: false});
        for (const valid of expected.validComponents ?? []) validator.validateComponent(valid);
        for (const invalid of expected.invalidComponents ?? []) assert.throws(() => validator.validateComponent(invalid));
        const session = createProtocol({catalogs: [catalog], send: () => assert.fail('Unexpected delivery')});
        try {
          const capabilities = session.capabilities();
          assertWireCapabilities(capabilities);
          assert.deepEqual(capabilities['1.0'].supportedCatalogIds, [catalog.id]);
        } finally {
          session.dispose();
        }
      }
      assert.equal(fetch.mock.callCount(), 0);
      if (illegalEnvelope) {
        record(suite, entry.name, 'skipped', 'The fixture wraps a component in ComponentCommon. A separate test uses the same leaf definitions in a flat component.');
      } else {
        record(suite, entry.name, 'passed');
      }
    } catch (error) {
      record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
      throw error;
    }
  });
}

test('reject forbidden catalog declarations before a renderer can advertise them', () => {
  const catalogId = 'shape-check';
  const components = {Card: {type: 'object', properties: {component: {const: 'Card'}}, required: ['component']}};
  const document = {catalogId, protocolVersion: '1.0', components};
  assert.throws(() => loadCatalog({...document, extra: true}), /Unknown catalog property 'extra'/);
  assert.throws(() => loadCatalog({...document, components: {...components, Surface: {type: 'object'}},
    $defs: {anyComponent: {oneOf: [{$ref: '#/components/Card'}]}},
  }), /Surface is reserved/);
  assert.throws(() => loadCatalog({...document, components: {Card: {
    ...components.Card, oneOf: [{properties: {layout: {const: 'grid'}}}],
  }}}), /Card.*Checkable trait import/);
});

test('programmatic catalog registration preserves unique identities and gesture boundaries', async () => {
  const fixture = (id, components = [], functions = []) => new Catalog(id, '1.0', components, functions);
  let executions = 0;
  const gesture = {
    name: 'gesture', requiresUserActivation: true, returnType: 'void', schema: z.object({}),
    execute() { executions++; },
  };
  const start = catalogs => createProtocol({catalogs, send() {}});
  assert.throws(() => start([basicCatalog, fixture(basicCatalog.id)]), /Catalog already registered/);
  assert.throws(() => start([fixture('broken', [{name: 'bad-name'}])]), /Component name.*UAX #31/);
  assert.throws(() => start([fixture('broken', [], [{...gesture, name: 'bad-name'}])]), /Function name.*UAX #31/);
  assert.throws(() => start([fixture('broken', [], [{...gesture, name: '@index'}])]), /Function name.*UAX #31/);
  for (const allowedCallers of ['agentOnly', 'rendererOrAgent']) {
    assert.throws(() => start([fixture('broken', [], [{...gesture, allowedCallers}])]), /must be rendererOnly/);
  }
  const local = fixture('local', [], [gesture]);
  const replies = [];
  const transport = createProtocol({catalogs: [basicCatalog, local], send: message => replies.push(message)});
  try {
    const capabilities = transport.capabilities();
    assertWireCapabilities(capabilities);
    assert.deepEqual(capabilities['1.0'].supportedCatalogIds, [basicCatalog.id, local.id]);
    await transport.receive({version: '1.0', callRendererFunction: {
      functionCallId: 'gesture_call',
      callFunction: {'@call': gesture.name, catalogId: local.id},
    }});
    assert.equal(replies.length, 1);
    assertWireMessage(replies[0]);
    const reply = replies[0].rendererFunctionResponse;
    assert.equal(reply.functionCallId, 'gesture_call');
    assert.equal(reply.error.code, 'INVALID_FUNCTION_CALL');
    assert.equal(executions, 0);
  } finally {
    transport.dispose();
  }
});

test('a rejected catalog leaves the host scene and viewport untouched', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    try {
      await page.goto(origin + '/test-support/fixture-host.html');
      const result = await page.evaluate(async () => {
        const {createProyeccion} = await import('/src/index.js');
        const viewport = document.createElement('div');
        let added = 0;
        const parent = {add() { added++; }};
        const catalog = {
          protocolVersion: '1.0', functions: new Map(),
          components: new Map([['Card', {name: 'Card', jsonSchema: {oneOf: [{type: 'object'}]}}]]),
        };
        try {
          createProyeccion({viewport, parent, catalogs: [catalog], send() {}});
        } catch (error) {
          return {error: error.name, added, layers: viewport.children.length};
        }
        return {added, layers: viewport.children.length};
      });
      assert.deepEqual(result, {error: 'A2uiCatalogError', added: 0, layers: 0});
    } finally {
      await page.close();
    }
  });
});

test('an accepting agent can negotiate and mount a locally installed inline catalog', async () => {
  const catalogId = 'https://example.com/catalogs/status/v1';
  const otherId = 'https://example.com/catalogs/other/v1';
  const accepting = {'1.0': {acceptsInlineCatalogs: true}};
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    await page.goto(origin + '/test-support/fixture-host.html');
    const capabilities = await page.evaluate(({catalogId, otherId, accepting}) => {
      const {fixture} = window;
      fixture.configure({secondary: [catalogId, otherId].map(catalogId => ({
        catalogId, protocolVersion: '1.0', components: {StatusBadge: true},
      }))});
      const {capabilities} = fixture.projection;
      const selected = {agentCapabilities: accepting, inlineCatalogIds: [catalogId, catalogId]};
      const first = capabilities(selected);
      first['1.0'].inlineCatalogs[0].components.StatusBadge.properties.badgeText.type = 'number';
      let unregisteredRejected = false;
      try {
        capabilities({...selected, inlineCatalogIds: ['absent']});
      } catch (error) {
        unregisteredRejected = error.name === 'A2uiCatalogError';
      }
      return {
        none: capabilities(),
        disabled: capabilities({agentCapabilities: {'1.0': {acceptsInlineCatalogs: false}}, inlineCatalogIds: [catalogId]}),
        unselected: capabilities({agentCapabilities: accepting}),
        negotiated: capabilities(selected),
        unregisteredRejected,
      };
    }, {catalogId, otherId, accepting});
    const expected = {'1.0': {supportedCatalogIds: [basicCatalog.id, catalogId, otherId]}};
    for (const key of ['none', 'disabled', 'unselected']) assert.deepEqual(capabilities[key], expected);
    assert.equal(capabilities.unregisteredRejected, true);
    const {inlineCatalogs, supportedCatalogIds} = capabilities.negotiated['1.0'];
    assertWireCapabilities(capabilities.negotiated);
    assert.deepEqual(supportedCatalogIds, expected['1.0'].supportedCatalogIds);
    assert.deepEqual(inlineCatalogs.map(doc => doc.catalogId), [catalogId]);
    assert.equal(inlineCatalogs[0].components.StatusBadge.properties.badgeText.type, 'string');

    const known = [new CatalogConfig(basicCatalog)];
    assert.deepEqual(resolveCatalogs(known, capabilities.negotiated).map(catalog => catalog.id), [basicCatalog.id]);
    const negotiated = resolveCatalogs(known, capabilities.negotiated, true);
    assert.deepEqual(negotiated.map(catalog => catalog.id), [basicCatalog.id, catalogId]);
    const generator = new A2uiGenerator(negotiated.map(catalog => new CatalogConfig(catalog)),
      undefined, new DirectJsonFormatFactory());
    const processor = generator.createProcessor(expected);
    const create = {version: '1.0', createSurface: {
      surfaceId: 'negotiated', catalogId,
      components: [{id: 'root', component: 'StatusBadge', badgeText: 'Inline catalog ready'}],
    }};
    const messages = processor.parseResponse('<a2ui-json>' + JSON.stringify([create]) + '</a2ui-json>',
      {state: processor.createState()}).flatMap(part => part.a2ui ?? []);
    assert.equal(messages.length, 1);
    await page.evaluate(messages => messages.forEach(message => window.fixture.projection.receive(message)), messages);
    await page.getByText('Inline catalog ready', {exact: true}).waitFor();
    assert.deepEqual(await page.evaluate(() => window.fixture.outbound), []);
    await page.close();
  });
});

const registrationSuite = 'core/add_catalog.yaml';
const registrationCatalog = path => loadCatalog(JSON.parse(fixture('catalogs/' + path.split('/').at(-1))));
for (const entry of parse(fixture('add_catalog.yaml'))) {
  test(entry.name, async () => {
    const outbound = [];
    const faults = [];
    const surfaces = new Map();
    const protocol = createProtocol({
      catalogs: entry.catalogPaths.map(registrationCatalog),
      send: message => outbound.push(message),
      onTransportError: error => faults.push(error),
      onSurfaceCreated: surface => surfaces.set(surface.id, surface),
    });
    try {
      for (const step of entry.steps) {
        const register = () => {
          for (const path of step.addCatalogPaths ?? []) protocol.addCatalog(registrationCatalog(path));
        };
        if (step.expectError) assert.equal(step.expectError.category, 'CatalogError');
        if (step.expectError && !step.messages) {
          const before = protocol.capabilities();
          assert.throws(register, {name: 'A2uiCatalogError'});
          assert.deepEqual(protocol.capabilities(), before);
        } else {
          register();
          for (const message of step.messages ?? []) await protocol.receive(message);
          if (step.expectError) {
            assert.equal(outbound.length, 1);
            const [message] = outbound.splice(0);
            assertWireMessage(message);
            assert.equal(message.error.code, 'CATALOG_NOT_FOUND');
            const surfaceId = (step.messages[0].createSurface ?? step.messages[0].updateComponents).surfaceId;
            assert.equal(message.error.surfaceId, surfaceId);
            assert.equal(surfaces.get(surfaceId)?.componentsModel.get('root'), undefined);
          }
        }
        assert.deepEqual(outbound, []);
        assert.deepEqual(faults, []);
      }
      for (const [id, expected] of Object.entries(entry.expect?.surfaces ?? {})) {
        assert.equal(Boolean(surfaces.get(id)), expected.exists);
      }
      if (entry.name === 'test_add_catalog_keeps_catalogs_of_earlier_surface') {
        assert.equal(surfaces.get('s_late').componentsModel.get('root')?.type, 'Gauge');
      }
      record(registrationSuite, entry.name, 'passed');
    } catch (error) {
      record(registrationSuite, entry.name, 'failed', String(error.message).slice(0, 1400));
      throw error;
    } finally {
      protocol.dispose();
    }
  });
}

test('the browser can add a widget catalog without changing an existing surface', async () => {
  const catalogId = 'https://example.com/catalogs/late/v1';
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    await page.goto(origin + '/test-support/fixture-host.html');
    const receive = message => page.evaluate(message =>
      window.fixture.projection.receive({version: '1.0', ...message}), message);
    await receive({createSurface: {surfaceId: 'early', catalogId: basicCatalog.id,
      components: [{id: 'root', component: 'Text', text: 'Existing surface'}],
    }});
    await page.getByText('Existing surface', {exact: true}).waitFor({timeout: 5000});

    await receive({addCatalog: {catalogId}});
    const before = await page.evaluate(() => ({
      capabilities: window.fixture.projection.capabilities(),
      failures: window.fixture.failures.splice(0),
    }));
    assert.deepEqual(before.capabilities['1.0'].supportedCatalogIds, [basicCatalog.id]);
    assert.equal(before.failures.length, 1);
    assert.match(before.failures[0], /'addCatalog' is not supported/);

    const capabilities = await page.evaluate(catalogId => {
      window.fixture.addStatusCatalog(catalogId);
      return window.fixture.projection.capabilities({
        agentCapabilities: {'1.0': {acceptsInlineCatalogs: true}}, inlineCatalogIds: [catalogId],
      });
    }, catalogId);
    assertWireCapabilities(capabilities);
    assert.deepEqual(capabilities['1.0'].supportedCatalogIds, [basicCatalog.id, catalogId]);
    assert.deepEqual(capabilities['1.0'].inlineCatalogs.map(catalog => catalog.catalogId), [catalogId]);
    const badge = {id: 'root', component: 'StatusBadge', badgeText: 'New catalog active'};
    await receive({updateComponents: {surfaceId: 'early', components: [{...badge, '@catalogId': catalogId}]}});
    const emitted = await page.evaluate(() => window.fixture.outbound.splice(0).map(row => row.message));
    assert.equal(emitted.length, 1);
    assertWireMessage(emitted[0]);
    assert.equal(emitted[0].error.code, 'CATALOG_NOT_FOUND');
    assert.equal(emitted[0].error.surfaceId, 'early');

    await receive({createSurface: {surfaceId: 'late', catalogId, components: [badge]}});
    await page.getByText('New catalog active', {exact: true}).waitFor({timeout: 5000});
    assert.equal(await page.getByText('Existing surface', {exact: true}).count(), 1);
    const after = await page.evaluate(catalogId => {
      const {fixture} = window;
      fixture.projection.dispose();
      let rejected = false;
      try {
        fixture.addStatusCatalog(catalogId);
      } catch (error) {
        rejected = /disposed/.test(error.message);
      }
      return {rejected, outbound: fixture.outbound, failures: fixture.failures};
    }, catalogId);
    assert.deepEqual(after, {rejected: true, outbound: [], failures: []});
    await page.close();
  });
});
