import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import test from 'node:test';
import {Catalog} from '@a2ui/web_core';
import {parse} from 'yaml';
import {basicCatalog, createProtocol} from '../src/protocol.js';
import {record} from '../test-support/conformance-manifest.js';

const suite = 'core/message_processor_scaling.yaml';
const readFixture = name => readFileSync(new URL('./fixtures/a2ui-v1/' + name, import.meta.url), 'utf8');
const entries = parse(readFixture('message_processor_scaling.yaml'));
const catalogs = new Map([
  ['catalogs/basic/v1/catalog.json', basicCatalog],
  ['conformance/test_data/catalogs/composition_catalog_v1_0.json',
    Catalog.fromJson(JSON.parse(readFixture('catalogs/composition.json')))],
]);

function makeMessages(template, size) {
  const fragments = template.map(part => {
    if (typeof part === 'string') return part;
    return Array.from({length: size}, (_, index) => part.repeat.replaceAll('{i}', String(index)))
      .join(part.separator);
  });
  return JSON.parse(fragments.join(''));
}

async function measure(catalog, messages, size, options) {
  let surface;
  const errors = [];
  const start = performance.now();
  const protocol = createProtocol({
    catalogs: [catalog],
    send: message => errors.push(message),
    onSurfaceCreated: model => { surface = model; },
    onTransportError: error => errors.push(error),
  });
  try {
    await protocol.receiveBatch(messages, options);
    const duration = performance.now() - start;
    assert.deepEqual(errors, []);
    assert.equal(surface.componentsModel.get('root').properties.children.length, size);
    assert.equal(surface.componentsModel.getAll().size, size + 1);
    assert.equal(surface.componentsModel.get('item_' + (size - 1)).properties.text, 'Item number ' + (size - 1));
    return duration;
  } finally {
    protocol.dispose();
  }
}

function median(samples) {
  return samples.sort((left, right) => left - right)[Math.floor(samples.length / 2)];
}

for (const entry of entries) {
  test(entry.name, async t => {
    try {
      assert.equal(entry.protocolVersion, '1.0');
      assert.equal(entry.action, 'measure_growth');
      assert.equal(entry.operation, 'process_messages');
      const validation = entry.args.validation_config;
      assert.ok(validation === 'relaxed' || validation === 'none');
      const catalog = catalogs.get(entry.catalogPaths[0]);
      assert.ok(catalog);
      // The renderer's default is already streaming validation. The upstream
      // default case has no caller override. The relaxed validated cases also
      // check declared elements while allowing references to arrive later.
      const options = validation === 'relaxed' ? {strictCatalog: true} : undefined;
      const samples = entry.sizes.map(size => ({size, messages: makeMessages(entry.payload, size), times: []}));
      for (const {size, messages} of samples) await measure(catalog, messages, size, options);
      for (let run = 0; run < 7; run++) {
        for (const {size, messages, times} of samples) times.push(await measure(catalog, messages, size, options));
      }
      const [small, large] = samples.map(({times}) => median(times));
      const ratio = large / small;
      t.diagnostic(`Median growth: ${small.toFixed(2)} ms to ${large.toFixed(2)} ms (${ratio.toFixed(2)}x)`);
      assert.ok(ratio <= entry.max_ratio, `Growth ${ratio.toFixed(2)}x exceeds ${entry.max_ratio}x`);
      record(suite, entry.name, 'passed');
    } catch (error) {
      record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
      throw error;
    }
  });
}
