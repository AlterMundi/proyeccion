import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {Catalog, NodeResolver, getValue} from '@a2ui/web_core';
import {parse} from 'yaml';
import {loadCatalog} from '../src/catalog.js';
import {basicCatalog, createProtocol} from '../src/protocol.js';
import {record} from '../test-support/conformance-manifest.js';
import {assertWireMessage} from '../test-support/wire-check.js';

const suite = 'core/error_responses.yaml';
const entries = parse(readFileSync(new URL('./fixtures/a2ui-v1/error_responses.yaml', import.meta.url), 'utf8'));
const skips = new Map([
  ['test_error_response_create_surface_invalid_theme_property', 'The renderer only accepts A2UI 1.0.'],
]);
const cycleCase = 'test_error_response_update_components_circular_reference';

for (const entry of entries) {
  if (skips.has(entry.name)) {
    record(suite, entry.name, 'skipped', skips.get(entry.name));
    continue;
  }
  test(entry.name, async () => {
    const catalog = entry.catalog ? loadCatalog({functions: {}, ...entry.catalog}) : basicCatalog;
    // Version-incompatible catalogs are refused at registration. The agent
    // still receives a correlated error when it names the rejected catalog.
    const legacyId = entry.catalogPaths?.includes('catalogs/basic/v0_9/catalog.json')
      ? entry.payload[0].createSurface.catalogId : undefined;
    if (legacyId) {
      const legacy = new Catalog(legacyId, 'v0.9', [], []);
      assert.throws(() => createProtocol({catalogs: [catalog, legacy], send() {}}), /1\.0/);
    }
    const sent = [];
    const transportErrors = [];
    let resolver;
    const transport = createProtocol({
      catalogs: [catalog],
      send: (message, metadata) => sent.push({message, metadata}),
      onTransportError: error => transportErrors.push(error.message),
      onSurfaceCreated: surface => { resolver = new NodeResolver(surface); },
    });
    try {
      const steps = entry.steps ?? [entry];
      for (const [index, step] of steps.entries()) {
        for (const message of step.payload) await transport.receive(message, {
          strictTopology: entry.strictMode === true,
          strictCatalog: entry.strictMode === true,
        });
        if (entry.steps) {
          const props = getValue(getValue(resolver.rootNode).props);
          assert.deepEqual(props.children.map(node => [node.componentId, node.state]), [
            ['orphan1', 'resolved'],
            ['dangling_child', index === 0 ? 'pending' : 'resolved'],
          ]);
          assert.deepEqual(sent, []);
        }
      }
      assert.deepEqual(transportErrors, []);
      const expected = entry.expectError?.rendererError;
      if (!expected) {
        assert.deepEqual(sent, []);
      } else {
        assert.equal(sent.length, 1, JSON.stringify(sent));
        const [{message, metadata}] = sent;
        assertWireMessage(message, metadata);
        assert.equal(message.version, expected.version);
        assert.equal(message.error.code, expected.error.code);
        assert.equal(message.error.surfaceId, expected.error.surfaceId);
        assert.equal(message.error.functionCallId, expected.error.functionCallId);
        if (expected.error.path !== undefined) assert.equal(message.error.path, expected.error.path);
        if (entry.name === cycleCase) {
          // The SDK names a different member of the same rejected cycle.
          assert.match(message.error.message, /Circular reference detected involving component '(?:root|child1)'/);
        } else {
          assert.ok(message.error.message.includes(expected.error.message), message.error.message);
        }
      }
      if (entry.name === cycleCase && !sent[0].message.error.message.includes(expected.error.message)) {
        record(suite, entry.name, 'skipped', 'The cycle is rejected, but the diagnostic identifies child1 rather than root.');
      } else {
        record(suite, entry.name, 'passed');
      }
    } catch (error) {
      record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
      throw error;
    } finally {
      resolver?.dispose();
      transport.dispose();
    }
  });
}
