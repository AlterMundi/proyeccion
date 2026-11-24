import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {Catalog, NodeResolver, getValue} from '@a2ui/web_core';
import {parse} from 'yaml';
import {basicCatalog, createProtocol} from '../src/protocol.js';
import {record} from '../test-support/conformance-manifest.js';
import {assertWireMessage} from '../test-support/wire-check.js';

const suite = 'core/composition_constraints.yaml';
const entries = parse(readFileSync(new URL('./fixtures/a2ui-v1/composition_constraints.yaml', import.meta.url), 'utf8'));
const basic = basicCatalog.copyWith({catalogId: 'basic'});

// Across SDKs the human-readable list in this diagnostic uses either
// JSON or single-quoted notation. Code, pointer and subject are exact.
function normalizeAllowedTypes(text) {
  return text.replace(/(Allowed (?:parents|children): )\[([^\]]*)\]/,
    (_, label, values) => label + JSON.stringify(JSON.parse('[' + values.replaceAll("'", '"') + ']')));
}

for (const entry of entries) {
  if (entry.name === 'test_composition_dropped_child_is_reported_as_orphan') {
    record(suite, entry.name, 'skipped', 'The interactive profile permits orphan definitions while incremental updates are arriving.');
    continue;
  }
  test(entry.name, async () => {
    const spec = entry.catalog.catalogSchema ?? entry.catalog;
    const catalog = spec.components ? Catalog.fromJson({
      protocolVersion: '1.0', functions: {}, ...spec,
    }) : basic;
    let surface;
    const outbound = [];
    const transportErrors = [];
    const protocol = createProtocol({
      catalogs: [catalog],
      send: (message, metadata) => outbound.push({message, metadata}),
      onSurfaceCreated: model => { surface = model; },
      onTransportError: error => transportErrors.push(error.message),
    });
    try {
      for (const [index, step] of entry.steps.entries()) {
        for (const message of step.payload) await protocol.receive(message);
        const expected = step.expectError ?? (index === entry.steps.length - 1 ? entry.expectError : undefined);
        if (!expected) {
          assert.deepEqual(outbound, []);
          continue;
        }
        assert.equal(outbound.length, 1, JSON.stringify(outbound));
        const [{message, metadata}] = outbound.splice(0);
        assertWireMessage(message, metadata);
        const error = expected.rendererError?.error ?? {
          code: expected.code, surfaceId: step.payload[0].createSurface.surfaceId,
          message: expected.message, path: message.error.path,
        };
        assert.deepEqual({...message.error, message: normalizeAllowedTypes(message.error.message)},
          {...error, message: normalizeAllowedTypes(error.message)});
        assert.equal(surface.disposed, true);
      }
      if (entry.expect) {
        const expected = entry.expect.surfaces.s1.components;
        assert.equal(surface.disposed, false);
        assert.deepEqual(Object.fromEntries([...surface.componentsModel.getAll().values()].map(model =>
          [model.id, {component: model.type, ...model.properties}])), expected);
        const resolver = new NodeResolver(surface);
        try {
          const root = getValue(resolver.rootNode);
          assert.equal(root.state, 'resolved');
          assert.deepEqual(getValue(root.props).children.map(child => child.componentId), expected.root.children);
        } finally {
          resolver.dispose();
        }
      }
      assert.deepEqual(transportErrors, []);
      record(suite, entry.name, 'passed');
    } catch (error) {
      record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
      throw error;
    } finally {
      protocol.dispose();
    }
  });
}

test('a late template row must satisfy its existing container and parent constraints', async () => {
  const catalog = Catalog.fromJson({
    catalogId: 'template', protocolVersion: '1.0', functions: {}, components: {
      Box: {type: 'object', allowedChildren: ['Row'],
        properties: {children: {$ref: '#/$defs/ChildList'}}},
      Row: {type: 'object', allowedParents: ['Box']},
      Other: {type: 'object', allowedParents: ['Box']},
    },
  });
  let resolver;
  const sent = [];
  const protocol = createProtocol({
    catalogs: [catalog],
    send: message => sent.push(message),
    onSurfaceCreated: surface => { resolver = new NodeResolver(surface); },
  });
  try {
    protocol.receive({version: '1.0', createSurface: {surfaceId: 's', catalogId: 'template',
      dataModel: {items: [{}, {}]}, components: [
        {id: 'root', component: 'Box', children: {path: '/items', componentId: 'row'}},
      ],
    }});
    const root = getValue(resolver.rootNode);
    assert.equal(root.state, 'resolved');
    const children = () => getValue(root.props).children;
    assert.deepEqual(children().map(node => node.state), ['pending', 'pending']);
    protocol.receive({version: '1.0', updateComponents: {
      surfaceId: 's', components: [{id: 'row', component: 'Other'}],
    }});
    assert.equal(sent.length, 1);
    assertWireMessage(sent[0]);
    assert.equal(sent[0].error.code, 'UNALLOWED_CHILD');
    assert.equal(sent[0].error.surfaceId, 's');
    assert.deepEqual(children().map(node => node.state), ['pending', 'pending']);
    protocol.receive({version: '1.0', updateComponents: {
      surfaceId: 's', components: [{id: 'row', component: 'Row'}],
    }});
    assert.deepEqual(children().map(node => [node.state, node.dataPath]), [
      ['resolved', '/items/0'], ['resolved', '/items/1'],
    ]);
  } finally {
    resolver?.dispose();
    protocol.dispose();
  }
});
