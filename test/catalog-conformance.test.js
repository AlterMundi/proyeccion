import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import test from 'node:test';
import {Catalog, DataContext, NodeResolver, getValue} from '@a2ui/web_core';
import {parse} from 'yaml';
import {z} from 'zod';
import {basicCatalog, createProtocol} from '../src/protocol.js';
import {record} from '../test-support/conformance-manifest.js';
import {assertWireCapabilities, assertWireMessage} from '../test-support/wire-check.js';

const suite = 'core/multi_catalog.yaml';
const cases = parse(readFileSync(new URL('./fixtures/a2ui-v1/multi_catalog.yaml', import.meta.url), 'utf8'));
const fixtureBasic = basicCatalog.copyWith({catalogId: 'basic'});

async function assertSelection(entry) {
  const {surface: spec, components = {}, functionCall, catalogs: versions = {}} = entry.args;
  const componentsOnWire = Object.entries(components).map(([id, body]) => ({...body, id}));
  // Selection fixtures are abstract. Each registered catalog accepts the same
  // types so the model's catalog identity establishes which definition won.
  const definitions = componentsOnWire.map(({component: name}) => ({
    name, schema: z.object({text: z.string().optional(), data: z.string().optional(), title: z.string().optional()}),
  }));
  const catalogs = spec.supportedCatalogIds.map(id => new Catalog(id,
    versions[id]?.protocolVersion ?? entry.catalog.protocolVersion, definitions, functionCall ? [{
      name: functionCall.call,
      schema: z.object({a: z.number(), b: z.number()}),
      returnType: 'string',
      execute: ({a, b}) => id + ':' + (a + b),
    }] : []));
  const messages = [];
  let model;
  const options = {
    catalogs,
    send: message => messages.push(message),
    onSurfaceCreated: surface => { model = surface; },
  };
  if (catalogs.some(catalog => catalog.protocolVersion !== '1.0')) {
    assert.equal(entry.expectError.category, 'CatalogError');
    assert.throws(() => createProtocol(options), /accepts only A2UI 1\.0 catalogs/);
    return;
  }
  const protocol = createProtocol(options);
  try {
    const capabilities = protocol.capabilities();
    assertWireCapabilities(capabilities);
    assert.deepEqual(capabilities['1.0'].supportedCatalogIds, spec.supportedCatalogIds);
    await protocol.receive({version: '1.0', createSurface: {
      surfaceId: spec.id, catalogId: spec.defaultCatalogId,
      ...(componentsOnWire.length ? {components: componentsOnWire} : {}),
    }});
    await setImmediate();
    if (entry.expectError) {
      assert.equal(entry.expectError.category, 'CatalogError');
      assert.equal(model.disposed, true);
      assert.equal(messages.length, 1);
      assertWireMessage(messages[0]);
      assert.equal(messages[0].error.code, 'CATALOG_NOT_FOUND');
      assert.equal(messages[0].error.surfaceId, spec.id);
      assert.match(messages[0].error.message, /unregistered_vendor_catalog/);
    } else if (functionCall) {
      const {call, ...fields} = functionCall;
      const value = new DataContext(model, '/').resolveDynamicValue({'@call': call, ...fields});
      assert.equal(value, entry.expectSelected + ':' + (fields.args.a + fields.args.b));
    } else {
      for (const {id, catalogId} of componentsOnWire) {
        assert.equal(model.componentsModel.get(id)?.catalog.id, catalogId ?? spec.defaultCatalogId);
      }
      assert.equal(model.componentsModel.get(componentsOnWire.at(-1).id)?.catalog.id, entry.expectSelected);
    }
    if (!entry.expectError) assert.deepEqual(messages, []);
  } finally {
    protocol.dispose();
  }
}

async function assertRendering(entry) {
  const catalogs = [fixtureBasic, ...entry.catalogs.map(document => Catalog.fromJson({
    ...document, $schema: 'https://a2ui.org/specification/v1_0/catalog_definition.json', functions: {},
  }))];
  const messages = [];
  let resolver;
  const protocol = createProtocol({
    catalogs,
    send: message => messages.push(message),
    onSurfaceCreated: surface => { resolver = new NodeResolver(surface); },
  });
  try {
    for (const {payload} of entry.steps) {
      for (const message of payload) await protocol.receive(message);
    }
    const root = getValue(resolver.rootNode);
    assert.ok(root);
    const nodes = new Map([[root.componentId, root]]);
    const children = getValue(root.props).children ?? [];
    for (const [index, node] of children.entries()) {
      nodes.set(node.componentId + '_' + index, node);
    }
    for (const [id, expected] of Object.entries(entry.expect.surfaces.main.components)) {
      const node = nodes.get(id);
      assert.equal(node.state, 'resolved');
      if (expected.component) assert.equal(node.type, expected.component);
      assert.equal(getValue(node.props).text.value, expected.text);
    }
    await setImmediate();
    assert.deepEqual(messages, []);
  } finally {
    resolver?.dispose();
    protocol.dispose();
  }
}

for (const entry of cases) {
  test(entry.name, async () => {
    try {
      if (entry.action === 'select_catalog') await assertSelection(entry);
      else {
        assert.equal(entry.action, 'validate');
        await assertRendering(entry);
      }
      record(suite, entry.name, 'passed');
    } catch (error) {
      record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
      throw error;
    }
  });
}
