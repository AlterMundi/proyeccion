import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {MAX_ARRAY_INDEX} from '@a2ui/web_core';
import {parse} from 'yaml';
import {basicCatalog, createProtocol} from '../src/protocol.js';
import {record} from '../test-support/conformance-manifest.js';
import {assertWireMessage} from '../test-support/wire-check.js';

const fixtureCatalog = basicCatalog.copyWith({catalogId: 'basic'});

for (const file of ['data_deletion', 'data_model_pointers']) {
  const cases = parse(readFileSync(new URL('./fixtures/a2ui-v1/' + file + '.yaml', import.meta.url), 'utf8'));
  const suite = 'core/' + file + '.yaml';
  for (const entry of cases) {
    test(entry.name, async () => {
      assert.equal(entry.catalog.protocolVersion, '1.0');
      assert.equal(entry.action, 'validate');
      const surfaces = new Map();
      const outbound = [];
      const transportFailures = [];
      const protocol = createProtocol({
        catalogs: [fixtureCatalog],
        send: message => outbound.push(message),
        onSurfaceCreated: surface => surfaces.set(surface.id, surface),
        onTransportError: error => transportFailures.push(error.message),
      });
      const snapshot = () => Object.fromEntries([...surfaces].map(([id, surface]) => [
        id, {dataModel: JSON.parse(JSON.stringify(surface.dataModel.get('/')))},
      ]));
      try {
        for (const {payload, expectError} of entry.steps) {
          const before = snapshot();
          for (const message of payload) await protocol.receive(message);
          assert.deepEqual(transportFailures, []);
          if (expectError) {
            assert.equal(expectError.category, 'DataError');
            assert.equal(outbound.length, 1);
            const [message] = outbound.splice(0);
            assertWireMessage(message);
            assert.equal(message.error.code, 'DATA_ERROR');
            assert.match(message.error.message, new RegExp(expectError.message));
            assert.deepEqual(snapshot(), before);
          } else {
            assert.deepEqual(outbound, []);
          }
        }
        if (entry.expect) assert.deepEqual({surfaces: snapshot()}, entry.expect);
        record(suite, entry.name, 'passed');
      } catch (error) {
        record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
        throw error;
      } finally {
        protocol.dispose();
      }
    });
  }
}

test('data-model metadata sends removed array entries as JSON null', async () => {
  let surface;
  const outbound = [];
  const transportFailures = [];
  const protocol = createProtocol({
    send: (message, metadata) => outbound.push({message, metadata}),
    onSurfaceCreated: model => { surface = model; },
    onTransportError: error => transportFailures.push(error.message),
  });
  try {
    await protocol.receive({version: '1.0', createSurface: {
      surfaceId: 'test', catalogId: basicCatalog.id, sendDataModel: true,
      dataModel: {values: ['a', 'b', 'c']},
    }});
    await protocol.receive({version: '1.0', updateDataModel: {
      surfaceId: 'test', path: '/values/1', value: null,
    }});
    surface.dispatchAction({name: 'read', context: {}}, 'fixture');
    assert.deepEqual(transportFailures, []);
    assert.equal(outbound.length, 1);
    assertWireMessage(outbound[0].message);
    assert.deepEqual(outbound[0].metadata.a2uiRendererDataModel, {
      version: '1.0', surfaces: {test: {values: ['a', null, 'c']}},
    });
  } finally {
    protocol.dispose();
  }
});

test('synchronized roots stay objects across wire updates, local writes and actions', async () => {
  const surfaces = new Map();
  const outbound = [];
  const transport = createProtocol({
    onSurfaceCreated: surface => surfaces.set(surface.id, surface),
    send(message, metadata) {
      assertWireMessage(message, metadata);
      outbound.push({message, metadata});
    },
  });
  const receive = (name, payload) => transport.receive({version: '1.0', [name]: payload});
  const write = (surfaceId, path, value) => receive('updateDataModel', {
    surfaceId, ...(path === undefined ? {} : {path}), value,
  });
  try {
    await receive('createSurface', {surfaceId: 'synced', catalogId: basicCatalog.id, sendDataModel: true});
    const surface = surfaces.get('synced');
    await write('synced', '', {list: [1, 2]});
    assert.deepEqual(outbound, []);
    assert.deepEqual(surface.dataModel.get('/'), {list: [1, 2]});
    await write('synced', '/', []);
    await write('synced', undefined, 'primitive');
    assert.deepEqual(outbound.map(({message, metadata}) => [message.error.code,
      message.error.path, metadata.a2uiRendererDataModel.surfaces.synced]), [
      ['VALIDATION_FAILED', '/value', {list: [1, 2]}],
      ['VALIDATION_FAILED', '/value', {list: [1, 2]}],
    ]);
    assert.throws(() => surface.dataModel.set('/', true), /requires a JSON object/);
    assert.deepEqual(surface.dataModel.get('/'), {list: [1, 2]});
    await write('synced', '/', null);
    await surface.dispatchAction({name: 'show'}, 'root');
    assert.deepEqual(outbound.at(-1).metadata.a2uiRendererDataModel.surfaces.synced, {});
    await receive('createSurface', {surfaceId: 'local', catalogId: basicCatalog.id});
    await write('local', '', [1]);
    assert.deepEqual(surfaces.get('local').dataModel.get('/'), [1]);
    assert.equal(outbound.length, 3);
  } finally {
    transport.dispose();
  }
});

test('createSurface preserves literal nulls in the initial model and later updates can remove them', async () => {
  let surface;
  let initialComponentData;
  const sent = [];
  const protocol = createProtocol({
    onSurfaceCreated: model => {
      surface = model;
      model.componentsModel.onCreated.subscribe(() => {
        initialComponentData = structuredClone(model.dataModel.get('/'));
      });
    },
    send(message, metadata) {
      assertWireMessage(message, metadata);
      sent.push({message, metadata});
    },
  });
  const surfaceId = 'initial_snapshot';
  const dataModel = {unset: null, '': null, nested: {unset: null}, label: 'Ready'};
  const update = (path, value) => protocol.receive({version: '1.0', updateDataModel: {surfaceId, path, value}});
  try {
    await protocol.receive({version: '1.0', createSurface: {
      surfaceId, catalogId: basicCatalog.id, dataModel,
      components: [{id: 'root', component: 'Card', child: 'root'}],
    }});
    assert.equal(sent.length, 1);
    assert.equal(sent.shift().message.error.surfaceId, surfaceId);
    assert.equal(surface.disposed, true);
    assert.equal(protocol.hasSurface(surfaceId), false);

    await protocol.receive({version: '1.0', createSurface: {
      surfaceId, catalogId: basicCatalog.id, sendDataModel: true, dataModel,
      components: [{id: 'root', component: 'Text', text: {'@path': '/label'}}],
    }});
    assert.deepEqual(sent, []);
    assert.deepEqual(surface.dataModel.get('/'), dataModel);
    assert.deepEqual(initialComponentData, dataModel);
    assert.equal(surface.componentsModel.get('root').properties.text['@path'], '/label');
    await surface.dispatchAction({name: 'check'}, 'root');
    assert.deepEqual(sent[0].metadata.a2uiRendererDataModel.surfaces[surfaceId], dataModel);

    await update('/unset', null);
    assert.deepEqual(surface.dataModel.get('/'), {'': null, nested: {unset: null}, label: 'Ready'});
    await update('/label', 'Updated');
    await surface.dispatchAction({name: 'check'}, 'root');
    assert.deepEqual(sent[1].metadata.a2uiRendererDataModel.surfaces[surfaceId],
      {'': null, nested: {unset: null}, label: 'Updated'});
    assert.equal(sent.length, 2);
  } finally {
    protocol.dispose();
  }
});

test('an all-separator pointer longer than one slash updates an empty key rather than the root', async () => {
  const outbound = [];
  const failures = [];
  let surface;
  const protocol = createProtocol({
    send(message, metadata) {
      assertWireMessage(message, metadata);
      outbound.push({message, metadata});
    },
    onTransportError: error => failures.push(error),
    onSurfaceCreated: model => { surface = model; },
  });
  const surfaceId = 'empty_key_sync';
  try {
    await protocol.receive({version: '1.0', createSurface: {
      surfaceId, catalogId: basicCatalog.id, sendDataModel: true,
      dataModel: {'': {'': 'Original'}, other: 'Keep'},
    }});
    assert.equal(surface.dataModel.get('//'), 'Original');
    await protocol.receive({version: '1.0', updateDataModel: {surfaceId, path: '//', value: 'Updated'}});
    assert.equal(surface.dataModel.get('//'), 'Updated');
    assert.deepEqual(surface.dataModel.get('/'), {'': {'': 'Updated'}, other: 'Keep'});
    assert.deepEqual(outbound, []);
    await surface.dispatchAction({name: 'read'}, 'root');
    assert.deepEqual(outbound[0].metadata.a2uiRendererDataModel.surfaces[surfaceId],
      {'': {'': 'Updated'}, other: 'Keep'});
    assert.deepEqual(failures, []);
  } finally {
    protocol.dispose();
  }
});

test('a rejected nested array write preserves the previous model and synchronized snapshot', async () => {
  let surface;
  const outbound = [];
  const protocol = createProtocol({
    send(message, metadata) {
      assertWireMessage(message, metadata);
      outbound.push({message, metadata});
    },
    onSurfaceCreated: model => { surface = model; },
  });
  const surfaceId = 'atomic_update';
  const initial = {rows: [null], title: 'Ready'};
  const receive = (name, body) => protocol.receive({version: '1.0', [name]: {surfaceId, ...body}});
  try {
    await receive('createSurface', {catalogId: basicCatalog.id, dataModel: initial, sendDataModel: true});
    const rejected = '/rows/0/cells/' + (MAX_ARRAY_INDEX + 1);
    await receive('updateDataModel', {path: rejected, value: 'Too far'});
    assert.equal(outbound.length, 1);
    assert.equal(outbound[0].message.error.code, 'DATA_ERROR');
    assert.equal(outbound[0].message.error.path, rejected);
    assert.deepEqual(surface.dataModel.get('/'), initial);
    assert.deepEqual(outbound[0].metadata.a2uiRendererDataModel.surfaces[surfaceId], initial);

    await receive('updateDataModel', {path: '/rows/1/cells/0', value: 'Valid'});
    const expected = {rows: [null, {cells: ['Valid']}], title: 'Ready'};
    assert.deepEqual(surface.dataModel.get('/'), expected);
    await surface.dispatchAction({name: 'read'}, 'root');
    assert.deepEqual(outbound[1].metadata.a2uiRendererDataModel.surfaces[surfaceId], expected);
  } finally {
    protocol.dispose();
  }
});
