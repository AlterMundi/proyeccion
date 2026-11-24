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
