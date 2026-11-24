import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {PayloadValidator} from '@a2ui/web_core/validation';
import {parse} from 'yaml';
import {loadCatalog} from '../src/catalog.js';
import {basicCatalog, createProtocol} from '../src/protocol.js';
import {record} from '../test-support/conformance-manifest.js';
import {assertWireCapabilities} from '../test-support/wire-check.js';

const suite = 'core/catalog.yaml';
const fixture = file => readFileSync(new URL('./fixtures/a2ui-v1/' + file, import.meta.url), 'utf8');
const entries = parse(fixture('catalog.yaml'));
const documents = new Map([
  ['catalogs/basic/v1/catalog.json', 'catalog.json'],
  ['catalogs/mcp/v1/catalog.json', 'catalogs/mcp.json'],
  ['catalogs/vegachart/v1/catalog.json', 'catalogs/vegachart.json'],
  ['conformance/test_data/catalogs/component_metadata_catalog_v1_0.json', 'catalogs/component-metadata.json'],
  ['conformance/test_data/catalogs/component_metadata_invalid_key_catalog_v1_0.json', 'catalogs/component-metadata-invalid.json'],
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
  const version = entry.protocolVersion ?? entry.catalog?.protocolVersion;
  if (entry.action !== 'from_json' || version !== '1.0') {
    record(suite, entry.name, 'skipped', entry.action === 'from_json'
      ? 'Outside the A2UI 1.0 loading profile.'
      : 'This run qualifies catalog loading. Serialization, round-tripping and derivation have separate entry points.');
    continue;
  }
  const illegalEnvelope = entry.name === 'test_v10_catalog_from_json_leaf_defs';
  test(illegalEnvelope ? entry.name + ' (canonical flat component)' : entry.name, t => {
    const file = documents.get(entry.catalogPath);
    const document = entry.catalogPath ? JSON.parse(fixture(file)) : entry.catalog;
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
