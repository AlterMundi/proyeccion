import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {Catalog, NodeResolver, getValue} from '@a2ui/web_core';
import {parse} from 'yaml';
import {z} from 'zod';
import {basicCatalog, createProtocol} from '../src/protocol.js';
import {record} from '../test-support/conformance-manifest.js';
import {assertWireCapabilities, assertWireMessage} from '../test-support/wire-check.js';

const suite = 'core/message_processor_v1_0.yaml';
const cases = parse(readFileSync(new URL('./fixtures/a2ui-v1/message_processor_v1_0.yaml', import.meta.url), 'utf8'));
const aliases = [basicCatalog, basicCatalog.copyWith({catalogId: 'basic'}),
  basicCatalog.copyWith({catalogId: 'test-catalog-v10'}),
  basicCatalog.copyWith({catalogId: 'https://a2ui.org/catalogs/basic/v1/catalog.json'})];

const unselected = new Map([
  ['test_v091_version_string_compatibility', 'The renderer registers only A2UI 1.0.'],
  ['test_v10_get_renderer_data_model_excludes_surface_without_default_from_v09', 'The renderer registers only A2UI 1.0.'],
  ['test_v10_get_renderer_data_model_filters_by_surface_protocol_version', 'The renderer registers only A2UI 1.0.'],
  ['test_v10_update_components_mismatched_catalog_protocol_version_error', 'The session refuses mixed-version registration up front.'],
  ['test_v10_call_naming_catalog_of_other_protocol_version_errors', 'The session refuses mixed-version registration up front.'],
  ['test_v10_custom_envelope_properties_declared_in_combiner_branches', 'A2UI 1.0 forbids structural root combinators. The renderer rejects the catalog before any component messages are processed.'],
]);
const transportDiagnostics = new Map([
  ['test_multiple_update_types_error', 'multiple conflicting update actions'],
  ['test_v10_rejects_v08_begin_rendering_action', "action 'beginRendering' is not supported"],
  ['test_unsupported_protocol_version_error', "Unsupported protocol version 'v99.0'"],
  ['test_missing_version_field_in_v10_process_messages_error', 'Missing required version field'],
]);

const partialTopologyOverride = 'test_v10_call_validation_config_leaves_out_rules_as_strict';

function catalogsFor(entry) {
  const charts = [{name: 'PieChart', schema: z.object({data: z.array(z.number())})}];
  const declared = (entry.catalogs ?? []).map(document => {
    if (document.components || document.functions) {
      return Catalog.fromJson({protocolVersion: '1.0', ...document});
    }
    if (document.catalogId === 'charts-catalog') return new Catalog(document.catalogId, '1.0', charts, []);
    return basicCatalog.copyWith({catalogId: document.catalogId});
  });
  if (entry.action === 'get_renderer_capabilities') return declared;
  return [...aliases, ...declared];
}

function verifySurfaces(models, expected) {
  for (const [id, shape] of Object.entries(expected.surfaces)) {
    const surface = models.get(id);
    if (shape.exists === false) {
      assert.equal(surface, undefined, id);
      continue;
    }
    assert.ok(surface, id);
    assert.equal(surface.disposed, false, id);
    for (const key of ['sendDataModel', 'metadata']) {
      if (key in shape) assert.deepEqual(surface[key], shape[key], id + '.' + key);
    }
    if ('dataModel' in shape) {
      assert.deepEqual(JSON.parse(JSON.stringify(surface.dataModel.get('/'))), shape.dataModel, id + '.dataModel');
    }
    if (shape.components) {
      const components = [...surface.componentsModel.getAll()];
      assert.equal(components.length, shape.components.length, id + ' component count');
      for (const {id: componentId, component, '@metadata': metadata, ...properties} of shape.components) {
        const model = surface.componentsModel.get(componentId);
        assert.equal(model?.type, component, componentId);
        if (metadata !== undefined) assert.deepEqual(model.metadata ?? null, metadata, componentId);
        for (const [key, expected] of Object.entries(properties)) {
          assert.deepEqual(model.properties[key], expected, componentId + '.' + key);
        }
      }
    }
  }
}

function verifyError(outbound, expected) {
  assert.equal(outbound.length, 1, JSON.stringify(outbound));
  const {message, metadata} = outbound[0];
  assertWireMessage(message, metadata);
  const codes = {
    CatalogError: ['CATALOG_NOT_FOUND', 'CATALOG_ERROR'],
    ValidationError: ['VALIDATION_FAILED'],
    IntegrityError: ['INTEGRITY_ERROR', 'RECURSION_LIMIT_EXCEEDED'],
    RecursionError: ['RECURSION_LIMIT_EXCEEDED'],
  };
  const expectedError = expected.rendererError?.error;
  if (expectedError) assert.equal(message.error.code, expectedError.code);
  else assert.ok(codes[expected.category]?.includes(message.error.code), JSON.stringify(message));
  for (const key of ['surfaceId', 'functionCallId', 'path']) {
    const wanted = expectedError?.[key] ?? expected[key];
    if (wanted !== undefined) assert.equal(message.error[key], wanted);
  }
  for (const text of [expected.message, expectedError?.message]) {
    if (text) assert.ok(message.error.message.includes(text), message.error.message);
  }
}

for (const entry of cases) {
  const reason = entry.name === partialTopologyOverride
    ? 'The SDK permits separate orphan and dangling-reference overrides. The renderer exposes a single complete-topology check.'
    : unselected.get(entry.name);
  if (reason) {
    record(suite, entry.name, 'skipped', reason);
    continue;
  }
  test(entry.name, async () => {
    const surfaces = new Map();
    const outbound = [];
    const transportErrors = [];
    const protocol = createProtocol({
      catalogs: catalogsFor(entry),
      send: (message, metadata) => outbound.push({message, metadata}),
      onTransportError: error => transportErrors.push(error.message),
      onSurfaceCreated: surface => surfaces.set(surface.id, surface),
      onSurfaceDeleted: id => surfaces.delete(id),
    });
    try {
      const diagnostic = transportDiagnostics.get(entry.name);
      if (entry.action === 'get_renderer_capabilities') {
        const capabilities = protocol.capabilities(entry.args?.includeInlineCatalogs ? {
          agentCapabilities: {'1.0': {acceptsInlineCatalogs: true}},
          inlineCatalogIds: entry.catalogs.map(document => document.catalogId),
        } : undefined);
        assertWireCapabilities(capabilities);
        assert.deepEqual(capabilities, entry.expect);
      } else {
        const strictMode = entry.strictMode === true;
        for (const step of entry.steps ?? [entry]) {
          const messages = step.messages ?? step.payload;
          const cyclicSurface = step.expectError?.rendererError?.error.code === 'RECURSION_LIMIT_EXCEEDED'
            ? surfaces.get(step.expectError.surfaceId) : undefined;
          const componentSnapshot = () => [...cyclicSurface.componentsModel.getAll().values()]
            .map(model => ({id: model.id, type: model.type, properties: structuredClone(model.properties)}));
          const before = cyclicSurface ? componentSnapshot() : undefined;
          // In the selected overrides, the only relaxed graph rule exercised
          // is whether a temporarily unattached component may be stored.
          const options = {
            strictCatalog: strictMode || step.validationConfig !== undefined,
            strictTopology: step.validationConfig === undefined ? strictMode : !step.validationConfig.allowOrphanComponents,
          };
          await protocol.receiveBatch(messages, options);
          if (cyclicSurface) assert.deepEqual(componentSnapshot(), before);
          if (diagnostic) {
            assert.equal(transportErrors.length, 1);
            assert.ok(transportErrors[0].includes(diagnostic), transportErrors[0]);
            assert.deepEqual(outbound, []);
            assert.equal(surfaces.size, 0);
          } else if (step.expectError) {
            const expected = step.expectError;
            if (expected.message === 'is not reachable from') {
              const {surfaceId} = messages[0].createSurface;
              verifyError(outbound.splice(0), {...expected, category: 'IntegrityError', surfaceId});
              assert.equal(surfaces.has(surfaceId), false);
            } else {
              verifyError(outbound.splice(0), expected);
            }
          } else {
            assert.deepEqual(outbound, []);
            if (entry.action === 'get_renderer_data_model') {
              const [id] = Object.keys(entry.expect.surfaces);
              const surface = surfaces.get(id);
              assert.equal(surface.protocolVersion, '1.0');
              await surface.dispatchAction({name: 'inspect', context: {}}, 'probe');
              assert.equal(outbound.length, 1);
              assertWireMessage(outbound[0].message, outbound[0].metadata);
              assert.deepEqual(outbound[0].metadata.a2uiRendererDataModel, entry.expect);
            } else if (step.expect) {
              verifySurfaces(surfaces, step.expect);
            }
          }
        }
      }
      if (!diagnostic) assert.deepEqual(transportErrors, []);
      record(suite, entry.name, 'passed');
    } catch (error) {
      record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
      throw error;
    } finally {
      protocol.dispose();
    }
  });
}

test('an unsupported reserved function fails locally when its binding resolves', async () => {
  const entry = cases.find(item => item.name === 'test_v10_undefined_system_function_errors');
  const emitted = [];
  let resolver;
  const protocol = createProtocol({
    send: message => emitted.push(message),
    onSurfaceCreated: surface => { resolver = new NodeResolver(surface); },
  });
  try {
    for (const message of entry.messages) await protocol.receive(message);
    const root = getValue(resolver.rootNode);
    assert.equal(root.state, 'resolved');
    assert.equal(getValue(root.props).text.value ?? null, null);
    await new Promise(queueMicrotask);
    assert.ok(emitted.length > 0);
    for (const message of emitted) {
      assertWireMessage(message);
      assert.equal(message.error.code, 'EXPRESSION_ERROR');
      assert.equal(message.error.surfaceId, 's');
      assert.match(message.error.message, /@foo/);
    }
  } finally {
    resolver?.dispose();
    protocol.dispose();
  }
});

test('reject a root combiner at catalog registration before interpreting its component fields', () => {
  const entry = cases.find(item => item.name === 'test_v10_custom_envelope_properties_declared_in_combiner_branches');
  const catalogs = catalogsFor(entry);
  assert.throws(() => createProtocol({catalogs, send: () => assert.fail('Unexpected delivery')}), {
    name: 'A2uiCatalogError', message: /Pager.*Checkable trait import/,
  });
});
