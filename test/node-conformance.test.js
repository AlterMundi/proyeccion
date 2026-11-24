import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {
  NodeResolver, ResolvedBinding, effect, getValue, isComponentNode, isWritable, peekValue,
} from '@a2ui/web_core';
import {parse} from 'yaml';
import {loadCatalog} from '../src/catalog.js';
import {basicCatalog, createProtocol} from '../src/protocol.js';
import {record} from '../test-support/conformance-manifest.js';
import {assertWireMessage} from '../test-support/wire-check.js';

const suite = 'core/node_resolution.yaml';
const fixtures = new URL('./fixtures/a2ui-v1/', import.meta.url);
const read = file => readFileSync(new URL(file, fixtures), 'utf8');
const entries = parse(read('node_resolution.yaml'));
const versionOne = new Set(['metadata.yaml', 'inline_create.yaml', 'event_property.yaml', 'direct_dynamic.yaml']);

function mapValue(value, path, visitNode) {
  if (isComponentNode(value)) {
    visitNode?.(value, path);
    return {node: path};
  }
  if (value instanceof ResolvedBinding) {
    return {value: mapValue(value.value, path), writable: isWritable(value)};
  }
  if (typeof value === 'function') return {action: true};
  if (Array.isArray(value)) return value.map((item, index) => mapValue(item, path + '/' + index, visitNode));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
      mapValue(item, path + '/' + key, visitNode)]));
  }
  return value ?? null;
}

function nodesFrom(root, readProps) {
  const nodes = new Map();
  const seen = new Set();
  function visit(node, path) {
    assert.ok(!seen.has(node) && !node.disposed, path);
    seen.add(node);
    nodes.set(path, node);
    const siblingIds = new Set();
    mapValue(readProps(node.props), path, (child, childPath) => {
      assert.ok(!siblingIds.has(child.instanceId), childPath);
      siblingIds.add(child.instanceId);
      visit(child, childPath);
    });
  }
  if (root) visit(root, 'root');
  return nodes;
}

function checkTree(nodes, expected) {
  assert.deepEqual([...nodes.keys()].sort(), Object.keys(expected).sort());
  for (const [path, fields] of Object.entries(expected)) {
    const node = nodes.get(path);
    const actual = {
      component_id: node.componentId, type: node.type, state: node.state, data_path: node.dataPath,
      metadata: peekValue(node.metadata) ?? null,
      props: mapValue(peekValue(node.props), path),
    };
    for (const [key, value] of Object.entries(fields)) {
      const observed = key === 'props' ? Object.fromEntries(Object.keys(value).map(name => [name, actual.props[name]])) : actual[key];
      assert.deepEqual(observed, value, path + '/' + key);
    }
  }
}

for (const entry of entries) {
  const filename = entry.fixture.split('/').at(-1);
  if (!versionOne.has(filename)) {
    record(suite, entry.name, 'skipped', 'Fixture uses the upstream A2UI 0.9.1 catalog.');
    continue;
  }
  test(entry.name, async () => {
    const fixture = parse(read('node/' + filename));
    const catalog = fixture.catalog === '../catalogs/basic/v1/catalog.json'
      ? basicCatalog : loadCatalog(JSON.parse(read('catalogs/' + fixture.catalog.split('/').at(-1))));
    const outbound = [];
    const faults = [];
    const watches = new Map();
    const cleanups = [];
    let model;
    let resolver;
    const transport = createProtocol({
      catalogs: [catalog],
      send(message, metadata) {
        assertWireMessage(message, metadata);
        outbound.push(message);
      },
      onTransportError: failure => faults.push(failure.message),
      onSurfaceCreated(surface) {
        model = surface;
        resolver = new NodeResolver(surface);
        cleanups.push(effect(() => {
          for (const [path, node] of nodesFrom(getValue(resolver.rootNode), getValue)) {
            if (watches.has(node)) continue;
            const watch = {props: -1, metadata: -1, destroyed: 0};
            watches.set(node, watch);
            cleanups.push(effect(() => {
              watch.last = mapValue(getValue(node.props), path);
              watch.props++;
            }));
            cleanups.push(effect(() => { getValue(node.metadata); watch.metadata++; }));
            const destroyed = node.onDestroyed.subscribe(() => { watch.destroyed++; });
            cleanups.push(() => destroyed.unsubscribe());
          }
        }));
      },
    });
    const receive = (name, payload) => transport.receive({version: '1.0', [name]: {surfaceId: 's', ...payload}});
    const nodes = () => resolver ? nodesFrom(peekValue(resolver.rootNode), peekValue) : new Map();
    function check(expected, before = new Map()) {
      const after = nodes();
      checkTree(after, expected.nodes);
      const retained = new Map([...after].filter(([path, node]) => before.get(path) === node));
      for (const [field, name] of [['props', 'emissions'], ['metadata', 'metadata_emissions']]) {
        const counts = [...retained].map(([path, node]) => [path, watches.get(node)[field]]);
        assert.deepEqual(Object.fromEntries(counts.filter(([, count]) => count > 0)), expected[name] ?? {}, name);
      }
      for (const [path, node] of retained) {
        const watch = watches.get(node);
        if (watch.props) assert.deepEqual(watch.last, mapValue(peekValue(node.props), path), path);
      }
      const destroyed = [...before].filter(([, node]) => watches.get(node).destroyed > 0);
      assert.deepEqual(Object.fromEntries(destroyed.map(([path, node]) => [path, watches.get(node).destroyed])),
        expected.destroyed ?? {});
      for (const [, node] of destroyed) assert.equal(node.disposed, true);
      if (expected.created_emissions) {
        const created = [...after].filter(([path, node]) => before.get(path) !== node);
        assert.deepEqual(Object.fromEntries(created.map(([path, node]) => [path, watches.get(node).props])),
          expected.created_emissions);
      }
      for (const path of expected.same_nodes ?? []) assert.equal(after.get(path), before.get(path), path);
      for (const [path, value] of Object.entries(expected.data ?? {})) assert.deepEqual(model.dataModel.get(path), value);
      assert.deepEqual(faults, []);
      assert.deepEqual(outbound.map(({action, error}) => {
        assert.equal(error, undefined);
        const {sourceComponentId, name, context, metadata, surfaceId} = action;
        assert.equal(surfaceId, 's');
        return {source_component_id: sourceComponentId, name, context, ...(metadata && {metadata})};
      }), expected.events ?? []);
    }
    try {
      if (fixture.surface !== false) {
        await receive('createSurface', {catalogId: catalog.id, dataModel: fixture.data, components: fixture.components});
      }
      check(entry.expect);
      for (const step of entry.steps) {
        const before = nodes();
        const bindingSnapshots = [...before.values()].flatMap(node =>
          Object.values(peekValue(node.props)).filter(value => value instanceof ResolvedBinding)
            .map(binding => [binding, mapValue(binding, '')]));
        for (const watch of watches.values()) Object.assign(watch, {props: 0, metadata: 0, destroyed: 0});
        outbound.length = 0;
        switch (step.op) {
          case 'process_messages':
            for (const message of step.messages) await transport.receive(message);
            break;
          case 'update_components': await receive('updateComponents', {components: step.components}); break;
          case 'set_data': await receive('updateDataModel', {path: step.path, value: step.value}); break;
          case 'write': peekValue(before.get(step.node).props)[step.property].set(step.value); break;
          case 'invoke':
            await peekValue(before.get(step.node).props)[step.property](step.metadata && {metadata: step.metadata});
            break;
          default: assert.fail('Unknown node fixture operation ' + step.op);
        }
        check(step.expect, before);
        for (const [binding, value] of bindingSnapshots) assert.deepEqual(mapValue(binding, ''), value);
      }
      record(suite, entry.name, 'passed');
    } catch (error) {
      record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
      throw error;
    } finally {
      for (const dispose of cleanups.reverse()) dispose();
      resolver?.dispose();
      transport.dispose();
    }
  });
}
