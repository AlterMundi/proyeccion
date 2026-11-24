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
  basicCatalog.copyWith({catalogId: 'test-catalog-v10'})];

const unselected = new Map([
  ['test_v10_get_renderer_capabilities_inline_catalogs', 'Inline catalog negotiation is not enabled in this renderer transport.'],
  ['test_batch_message_array_and_wrapper', 'The session accepts individual envelopes and JSON Lines. SDK container objects are outside this binding.'],
  ['test_v091_version_string_compatibility', 'The renderer registers only A2UI 1.0.'],
  ['test_v10_get_renderer_data_model_excludes_surface_without_default_from_v09', 'The renderer registers only A2UI 1.0.'],
  ['test_v10_get_renderer_data_model_filters_by_surface_protocol_version', 'The renderer registers only A2UI 1.0.'],
  ['test_v10_update_components_mismatched_catalog_protocol_version_error', 'The session refuses mixed-version registration up front.'],
  ['test_v10_call_naming_catalog_of_other_protocol_version_errors', 'The session refuses mixed-version registration up front.'],
  ['test_v10_component_update_without_catalog_id_uses_surface_default', 'Strict rejection of an unknown component differs from placeholder resolution in the streaming profile.'],
  ['test_v10_component_naming_catalog_is_checked_against_that_catalog', 'Strict rejection of an unknown component differs from placeholder resolution in the streaming profile.'],
  ['test_v10_undefined_system_function_errors', 'This profile reports the reserved-name failure at view evaluation. The split test verifies that it never invokes the agent.'],
  ['test_v10_custom_envelope_properties_declared_in_combiner_branches', 'Web Core 0.16.1 misreads catalogId nested under allOf/anyOf as a catalog route. The split test verifies the rejection.'],
  ['test_v10_create_surface_theme_rejected_strict', 'The streaming profile discards the legacy theme field, as verified in adapter_conformance.yaml.'],
]);
const transportDiagnostics = new Map([
  ['test_multiple_update_types_error', 'multiple conflicting update actions'],
  ['test_v10_rejects_v08_begin_rendering_action', "action 'beginRendering' is not supported"],
  ['test_unsupported_protocol_version_error', "Unsupported protocol version 'v99.0'"],
  ['test_missing_version_field_in_v10_process_messages_error', 'Missing required version field'],
]);

function excluded(entry) {
  const expected = entry.expectError;
  if (entry.steps?.some(step => step.validationConfig)) return 'One-off SDK validation settings are outside the streaming transport.';
  if (entry.strictMode && expected?.message?.startsWith('Unrecognized function')) {
    return 'The streaming renderer permits undeclared functions for A2UI 1.0 fallback routing.';
  }
  return unselected.get(entry.name);
}

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
  const reason = excluded(entry);
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
        const capabilities = protocol.capabilities();
        assertWireCapabilities(capabilities);
        assert.deepEqual(capabilities, entry.expect);
      } else {
        for (const step of entry.steps ?? [entry]) {
          const messages = step.messages ?? step.payload;
          assert.ok(Array.isArray(messages));
          const cyclicSurface = step.expectError?.rendererError?.error.code === 'RECURSION_LIMIT_EXCEEDED'
            ? surfaces.get(step.expectError.surfaceId) : undefined;
          const componentSnapshot = () => [...cyclicSurface.componentsModel.getAll()]
            .map(model => ({id: model.id, type: model.type, properties: structuredClone(model.properties)}));
          const before = cyclicSurface ? componentSnapshot() : undefined;
          for (const message of messages) await protocol.receive(message);
          if (cyclicSurface) assert.deepEqual(componentSnapshot(), before);
          if (diagnostic) {
            assert.equal(transportErrors.length, 1);
            assert.ok(transportErrors[0].includes(diagnostic), transportErrors[0]);
            assert.deepEqual(outbound, []);
            assert.equal(surfaces.size, 0);
          } else if (step.expectError) {
            verifyError(outbound.splice(0), step.expectError);
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

test('document the installed SDK rejection of custom properties in catalog combiners', async () => {
  const entry = cases.find(item => item.name === 'test_v10_custom_envelope_properties_declared_in_combiner_branches');
  const outbound = [];
  const protocol = createProtocol({
    catalogs: catalogsFor(entry),
    send: (message, metadata) => outbound.push({message, metadata}),
  });
  try {
    for (const message of entry.messages) await protocol.receive(message);
    verifyError(outbound, {category: 'CatalogError', surfaceId: 's_v10_combiner_custom', message: 'page-catalog'});
  } finally {
    protocol.dispose();
  }
});
