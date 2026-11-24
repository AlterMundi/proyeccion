import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {basicCatalog} from '../src/protocol.js';
import {withBrowser} from '../test-support/browser.js';
import {assertWireCapabilities} from '../test-support/wire-check.js';

const canonical = new URL('./fixtures/a2ui-v1/catalogs/vegachart.json', import.meta.url);
const packaged = new URL('../src/catalogs/vegachart.json', import.meta.url);

test('the optional VegaChart catalog mounts and updates Vega-Lite and Vega on a Three.js surface', async () => {
  assert.deepEqual(readFileSync(packaged), readFileSync(canonical));
  const spectrum = {
    $schema: 'https://vega.github.io/schema/vega-lite/v6.json',
    data: {values: [{hz: 40.4, amplitude: 2}, {hz: 80.8, amplitude: 4}, {hz: 121.2, amplitude: 1}]},
    mark: 'line',
    encoding: {x: {field: 'hz', type: 'quantitative'}, y: {field: 'amplitude', type: 'quantitative'}},
  };
  const native = {
    $schema: 'https://vega.github.io/schema/vega/v6.json',
    signals: [{name: 'amount', value: 7, bind: {element: '#host-field'}}],
    marks: [{type: 'text', encode: {enter: {x: {value: 10}, y: {value: 18}, text: {value: 'Native Vega'}}}}],
  };
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    page.setDefaultTimeout(8000);
    const externalRequests = [];
    await page.route('https://chart-fixture.example/**', route => {
      externalRequests.push(route.request().url());
      return route.abort();
    });
    await page.goto(origin + '/test-support/fixture-host.html');
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'host-field';
      input.value = 'host value';
      document.body.append(input);
    });
    const catalogId = await page.evaluate(() => window.fixture.addVegaChartCatalog());
    assert.equal(catalogId, JSON.parse(readFileSync(canonical, 'utf8')).catalogId);
    const capabilities = await page.evaluate(() => window.fixture.projection.capabilities());
    assertWireCapabilities(capabilities);
    assert.deepEqual(capabilities['1.0'].supportedCatalogIds, [basicCatalog.id, catalogId]);

    const receive = body => page.evaluate(body => window.fixture.projection.receive({version: '1.0', ...body}), body);
    await receive({createSurface: {
      surfaceId: 'spectrum', catalogId: basicCatalog.id, dataModel: {chart: spectrum, height: 120},
      components: [
        {id: 'root', component: 'Column', children: ['label', 'chart']},
        {id: 'label', component: 'Text', text: 'Spectrum'},
        {id: 'chart', component: 'VegaChart', '@catalogId': catalogId,
          spec: {'@path': '/chart'}, height: {'@path': '/height'}},
      ],
    }});
    await page.getByText('Spectrum', {exact: true}).waitFor();
    const svg = page.locator('[data-vega-chart] svg');
    const line = svg.locator('.mark-line path');
    await line.waitFor();
    const initial = await line.getAttribute('d');
    const height = Number(await svg.getAttribute('height'));
    const write = (path, value) => receive({updateDataModel: {surfaceId: 'spectrum', path, value}});
    await write('/height', 170);
    await page.waitForFunction(height => Number(document.querySelector('[data-vega-chart] svg')?.getAttribute('height')) > height,
      height);
    await write('/chart', {...spectrum, data: {values: [...spectrum.data.values, {hz: 161.6, amplitude: 5}]}});
    assert.notEqual(await line.getAttribute('d'), initial);

    await write('/chart', {...native, data: [{name: 'external', url: 'https://chart-fixture.example/data.json'}]});
    await page.getByText('Chart unavailable', {exact: true}).waitFor();
    assert.deepEqual(externalRequests, []);
    await write('/chart', native);
    await svg.getByText('Native Vega', {exact: true}).waitFor();
    assert.equal(await svg.count(), 1);
    assert.equal(await page.locator('#host-field').inputValue(), 'host value');
    await receive({deleteSurface: {surfaceId: 'spectrum'}});
    await svg.waitFor({state: 'detached'});
    assert.deepEqual(await page.evaluate(() => [window.fixture.outbound, window.fixture.failures]), [[], []]);
    await page.close();
  }, process.env.PROYECCION_BROWSER_PROJECT);
});
