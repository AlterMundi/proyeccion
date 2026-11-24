import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
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
