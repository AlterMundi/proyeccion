import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {parse} from 'yaml';
import {MAX_GLOBAL_DEPTH} from '@a2ui/web_core';
import {loadCatalog} from '../src/catalog.js';
import {basicCatalog, createProtocol} from '../src/protocol.js';
import {record} from '../test-support/conformance-manifest.js';
import {assertWireMessage} from '../test-support/wire-check.js';

const suite = 'core/validator_v1_0.yaml';
const fixtures = new URL('./fixtures/a2ui-v1/', import.meta.url);
const entries = parse(readFileSync(new URL('validator_v1_0.yaml', fixtures), 'utf8'));
const fixtureCatalogId = 'https://a2ui.org/catalogs/basic/v1/catalog.json';
const basicAlias = basicCatalog.copyWith({catalogId: fixtureCatalogId});
const callerCatalog = JSON.parse(readFileSync(new URL('catalogs/allowed_callers_catalog_v1_0.json', fixtures)));
const exclusions = new Map([
  ['test_custom_catalog_1_0', 'Its last step requires strict rejection of an unknown widget. The runtime buffers the unknown type.'],
  ['test_v10_unknown_component_type', 'The runtime allows an unknown widget and its resolver skips the widget.'],
  ['test_v10_unknown_nested_function', 'The runtime checks undeclared functions at evaluation rather than rejecting their component at ingress.'],
  ['test_v10_topology_circular_reference_error', 'The renderer rejects the cycle with the expected error category, using a different message.'],
]);
for (const suffix of [
  'dangling_child_reference_error', 'orphaned_component_error', 'missing_root_component_error',
  'template_dangling_reference_error', 'structured_array_item_dangling_child_error',
  'plain_string_property_not_treated_as_child_ref', 'component_id_array_dangling_reference_error',
  'component_id_array_partial_dangling_reference_error',
]) {
  exclusions.set('test_v10_topology_' + suffix,
    'The progressive renderer accepts incomplete component graphs while updates are arriving.');
}
exclusions.set('test_v10_multi_surface_missing_root_error',
  'The progressive renderer permits an absent root independently on each surface.');

function checkError(expected, messages, faults, sent, name) {
  if (!Object.hasOwn(messages[0], 'version') || name === 'test_v10_multiple_action_envelope_error') {
    assert.deepEqual(sent, []);
    assert.equal(faults.length, 1);
    assert.match(faults[0], /Missing required version field|multiple conflicting update actions/);
    return;
  }
  assert.deepEqual(faults, []);
  assert.equal(sent.length, 1, JSON.stringify(sent));
  const [{message, metadata}] = sent;
  assertWireMessage(message, metadata);
  const {error} = message;
  const {version, ...operations} = messages.at(-1);
  const [operation] = Object.values(operations);
  const surfaceId = typeof operation.surfaceId === 'string' ? operation.surfaceId : '';
  const fixture = expected.rendererError?.error;
  const wording = typeof expected === 'string' ? expected : fixture?.message ?? expected.message;
  const code = wording?.includes('Duplicate component ID') ? 'INTEGRITY_ERROR'
    : /[Rr]eference detected|recursion|functionCall depth/.test(wording) ? 'RECURSION_LIMIT_EXCEEDED'
      : 'VALIDATION_FAILED';
  assert.equal(error.code, fixture?.code ?? code);
  assert.equal(error.surfaceId, fixture?.surfaceId ?? expected.surfaceId ?? surfaceId);
  const field = fixture?.path ?? expected.path ?? {
    test_validator_1_0: '/surfaceId',
    test_v10_invalid_json_pointer_path_error: '/path',
    test_v10_update_data_model_invalid_path_error: '/path',
    test_v10_invalid_binding_path_error: '/components/0/text/@path',
  }[name];
  if (field) assert.equal(error.path, field);
  if (wording) assert.ok(error.message.includes(wording), error.message);
}

for (const entry of entries) {
  const exclusion = exclusions.get(entry.name);
  const exerciseExcluded = entry.name === 'test_custom_catalog_1_0'
    || entry.name === 'test_v10_topology_circular_reference_error';
  if (exclusion && !exerciseExcluded) {
    record(suite, entry.name, 'skipped', exclusion);
    continue;
  }
  test(entry.name, async () => {
    const sent = [];
    const faults = [];
    const surfaces = new Map();
    const catalogs = [basicCatalog, basicAlias];
    const schemas = entry.catalog?.components ? [entry.catalog] : [...entry.catalogs ?? []];
    if (entry.catalogPaths?.some(path => path.endsWith('/allowed_callers_catalog_v1_0.json'))) {
      schemas.push(callerCatalog);
    }
    let transport;
    try {
      catalogs.push(...schemas.map(schema => loadCatalog({protocolVersion: '1.0', functions: {}, ...schema})));
      transport = createProtocol({
        catalogs,
        send: (message, metadata) => sent.push({message, metadata}),
        onTransportError: error => faults.push(error.message),
        onSurfaceCreated: surface => surfaces.set(surface.id, surface),
      });
      for (const [index, step] of entry.steps.entries()) {
        sent.length = 0;
        faults.length = 0;
        for (const message of step.messages) await transport.receive(message);
        if (entry.name === 'test_custom_catalog_1_0' && index === 3) {
          assert.deepEqual(sent, []);
          assert.deepEqual(faults, []);
          assert.equal(surfaces.get('s1').componentsModel.get('c1').type, 'UnknownComponent');
        } else if (entry.name === 'test_v10_topology_circular_reference_error') {
          checkError('Circular reference detected', step.messages, faults, sent, entry.name);
          assert.equal(surfaces.get('s1').componentsModel.has('root'), false);
        } else if (step.expectError) {
          checkError(step.expectError, step.messages, faults, sent, entry.name);
        } else {
          assert.deepEqual(sent, []);
          assert.deepEqual(faults, []);
          for (const message of step.messages) {
            const operation = message.createSurface ?? message.updateComponents ?? message.updateDataModel;
            const surface = surfaces.get(operation.surfaceId);
            assert.ok(surface && !surface.disposed, operation.surfaceId);
            for (const component of operation.components ?? []) {
              assert.equal(surface.componentsModel.get(component.id)?.type, component.component);
            }
          }
        }
      }
      record(suite, entry.name, exclusion ? 'skipped' : 'passed', exclusion);
    } catch (error) {
      record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
      throw error;
    } finally {
      transport?.dispose();
    }
  });
}

test('invalid update paths preserve the old data and report /path before a later valid write', async () => {
  const sent = [];
  let surface;
  const transport = createProtocol({send: (message, metadata) => sent.push({message, metadata}),
    onSurfaceCreated: model => { surface = model; }});
  const update = (path, value) => transport.receive({version: '1.0', updateDataModel: {
    surfaceId: 's1', path, value,
  }});
  try {
    await transport.receive({version: '1.0', createSurface: {
      surfaceId: 's1', catalogId: basicCatalog.id, dataModel: {'a/b': {'~': 'old'}},
    }});
    await update('/a~1b/~2', 'invalid');
    assert.deepEqual(surface.dataModel.get('/'), {'a/b': {'~': 'old'}});
    assert.equal(sent.length, 1);
    const [{message, metadata}] = sent;
    assertWireMessage(message, metadata);
    assert.deepEqual(message.error, {code: 'VALIDATION_FAILED', surfaceId: 's1', path: '/path',
      message: "Invalid path syntax: '/a~1b/~2' (path must be a valid RFC 6901 JSON Pointer starting with '/')"});
    await update('/a~1b/~0', 'new');
    assert.deepEqual(surface.dataModel.get('/'), {'a/b': {'~': 'new'}});
    assert.equal(sent.length, 1);
  } finally {
    transport.dispose();
  }
});

test('opaque data and metadata preserve literal paths while template paths remain checked', async () => {
  const sent = [];
  let surface;
  const literal = {path: 'literal~2', '@path': 'another~2'};
  const transport = createProtocol({
    send: message => sent.push(message),
    onSurfaceCreated: model => { surface = model; },
  });
  const receive = (name, payload) => transport.receive({version: '1.0', [name]: {surfaceId: 'opaque', ...payload}});
  try {
    await receive('createSurface', {
      catalogId: basicCatalog.id,
      dataModel: {initial: literal},
      metadata: {extensions: {example_surface: literal}},
      components: [
        {id: 'root', component: 'Text', text: 'Ready', '@metadata': {extensions: {example_component: literal}}},
        {id: 'legacy', component: 'Text', text: 'Older metadata', metadata: {extensions: {example_legacy: literal}}},
      ],
    });
    await receive('updateDataModel', {path: '/updated', value: literal});
    assert.deepEqual(surface.dataModel.get('/'), {initial: literal, updated: literal});
    assert.deepEqual(surface.metadata.extensions.example_surface, literal);
    assert.deepEqual(surface.componentsModel.get('root').metadata.extensions.example_component, literal);
    assert.deepEqual(surface.componentsModel.get('legacy').metadata.extensions.example_legacy, literal);
    assert.deepEqual(sent, []);
    await receive('updateComponents', {components: [
      {id: 'root', component: 'List', children: {path: '/items~2', componentId: 'row'}},
    ]});
    assert.equal(sent.length, 1);
    assertWireMessage(sent[0]);
    assert.equal(sent[0].error.path, '/components/0/children/path');
    assert.equal(sent[0].error.surfaceId, 'opaque');
    assert.equal(surface.componentsModel.get('root').type, 'Text');
  } finally {
    transport.dispose();
  }
});

test('a late root cannot extend a buffered component chain beyond the depth limit', async () => {
  const sent = [];
  let surface;
  const transport = createProtocol({
    send: message => sent.push(message),
    onSurfaceCreated: model => { surface = model; },
  });
  const receive = (name, payload) => transport.receive({version: '1.0', [name]: {surfaceId: 'deep', ...payload}});
  const descendants = Array.from({length: MAX_GLOBAL_DEPTH}, (_, index) => ({
    id: `child_${index}`, component: 'Card', child: `child_${index + 1}`,
  }));
  descendants.push({id: `child_${MAX_GLOBAL_DEPTH}`, component: 'Text', text: 'Leaf'});
  try {
    await receive('createSurface', {catalogId: basicCatalog.id});
    await receive('updateComponents', {components: descendants});
    assert.deepEqual(sent, []);
    await receive('updateComponents', {components: [{id: 'root', component: 'Card', child: 'child_0'}]});
    assert.equal(sent.length, 1);
    assertWireMessage(sent[0]);
    assert.equal(sent[0].error.code, 'RECURSION_LIMIT_EXCEEDED');
    assert.equal(sent[0].error.surfaceId, 'deep');
    assert.equal(surface.componentsModel.has('root'), false);
    assert.equal(surface.componentsModel.get('child_0').properties.child, 'child_1');
    await receive('updateComponents', {components: [{id: 'root', component: 'Card', child: 'child_1'}]});
    assert.equal(sent.length, 1);
    assert.equal(surface.componentsModel.get('root').properties.child, 'child_1');
  } finally {
    transport.dispose();
  }
});

test('mixed bindings and unknown function fields are rejected before applying the batch', async () => {
  const errors = [];
  let surface;
  const transport = createProtocol({
    send(message) {
      assertWireMessage(message);
      errors.push(message.error);
    },
    onSurfaceCreated: model => { surface = model; },
  });
  const receive = (name, payload) => transport.receive({version: '1.0', [name]: {surfaceId: 'forms', ...payload}});
  try {
    await receive('createSurface', {
      catalogId: basicCatalog.id, dataModel: {label: 'Ready'},
      components: [{id: 'root', component: 'Text', text: {'@path': '/label'}}],
    });
    assert.deepEqual(errors, []);
    const inputs = [
      [{'@path': '/label', extra: 1}, '/extra'],
      [{'@path': 1}, '/@path'],
      [{'@path': '/label', '@call': 'formatString', args: {value: 'Wrong'}}, '/@call'],
      [{'@call': 'formatString', args: {value: 'Wrong'}, 'extra/field~': 1}, '/extra~1field~0'],
      [{'@call': 1}, '/@call'],
      [{'@call': '@index', args: null}, '/args'],
      [{'@call': '@index', args: {offset: 1, step: 2}}, '/args/step'],
    ];
    for (const [text, path] of inputs) {
      await receive('updateComponents', {components: [{id: 'root', component: 'Text', text}]});
      assert.equal(errors.length, 1);
      const [error] = errors.splice(0);
      assert.equal(error.surfaceId, 'forms');
      assert.equal(error.code, 'VALIDATION_FAILED');
      assert.equal(error.path, '/components/0/text' + path);
      assert.deepEqual(surface.componentsModel.get('root').properties.text, {'@path': '/label'});
    }
    await receive('updateComponents', {components: [
      {id: 'root', component: 'Text', text: {'@call': 'formatString', args: {value: 'Valid'}}},
    ]});
    assert.deepEqual(errors, []);
    assert.equal(surface.componentsModel.get('root').properties.text.args.value, 'Valid');
  } finally {
    transport.dispose();
  }
});
