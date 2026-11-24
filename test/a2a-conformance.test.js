import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {A2uiGenerator, CatalogConfig, DirectJsonFormatFactory, RendererToAgentMessageProcessor,
  readRendererCapabilities} from '@a2ui/agent';
import {parse} from 'yaml';
import {A2UI_A2A_EXTENSION, createA2aBinding} from '../src/a2a.js';
import {basicCatalog, createProtocol} from '../src/protocol.js';
import {withBrowser} from '../test-support/browser.js';
import {record} from '../test-support/conformance-manifest.js';
import {assertWireMessage} from '../test-support/wire-check.js';

const mimeType = 'application/a2ui+json';
const suite = 'extensions/a2a/a2a_integration.yaml';
const cases = parse(readFileSync(new URL('./fixtures/a2ui-v1/' + suite, import.meta.url), 'utf8'));

for (const entry of cases) {
  if (entry.action !== 'is_a2ui_part') {
    record(suite, entry.name, 'skipped', entry.action === 'create_a2ui_part'
      ? 'Exercises pre-1.0 agent encoding of an arbitrary object. The renderer binds 1.0 arrays of envelopes.'
      : 'Exercises agent extension advertisement, activation selection or legacy version negotiation. The renderer requests the pinned 1.0 A2UI URI.');
    continue;
  }
  test(entry.name, () => {
    try {
      const seen = [];
      const binding = createA2aBinding({receive: envelope => seen.push(envelope)});
      const envelope = {version: '1.0', deleteSurface: {surfaceId: 'example'}};
      binding.receiveParts([{data: [envelope], metadata: {mimeType: entry.args.mimeType}}]);
      assert.equal(seen.length > 0, entry.expect);
      assert.deepEqual(seen, [envelope]);
      record(suite, entry.name, 'passed');
    } catch (error) {
      record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
      throw error;
    }
  });
}

test('A2A emits a per-turn capability offer and negotiates the selected part and activation dialect', () => {
  const renderer = createProtocol({send: () => {}});
  try {
    const agentCard = {capabilities: {extensions: [{
      uri: A2UI_A2A_EXTENSION, params: {acceptsInlineCatalogs: true},
    }]}};
    const call = {version: '1.0', rendererFunctionResponse: {functionCallId: 'example', value: null}};
    for (const a2aVersion of ['1.0', '0.3']) {
      const binding = createA2aBinding(renderer, {a2aVersion, agentCard, inlineCatalogIds: [basicCatalog.id]});
      assert.deepEqual(binding.headers(), {'A2A-Version': a2aVersion});
      assert.deepEqual(binding.headers({activate: true}), {
        'A2A-Version': a2aVersion,
        [a2aVersion === '0.3' ? 'X-A2A-Extensions' : 'A2A-Extensions']: A2UI_A2A_EXTENSION,
      });
      const defaults = binding.encodeMessage({}, {envelope: call});
      assert.deepEqual(defaults.parts, [{
        ...(a2aVersion === '0.3' ? {kind: 'data'} : {mediaType: mimeType}),
        data: [call], metadata: {mimeType},
      }]);
      assert.deepEqual(readRendererCapabilities(defaults.metadata)['1.0'].inlineCatalogs.map(catalog => catalog.catalogId),
        [basicCatalog.id]);
      const model = {a2uiRendererDataModel: {version: '1.0', surfaces: {study: {selected: 'weaver'}}}};
      assert.deepEqual(binding.encodeMessage({}, {rendererMetadata: model}).metadata.a2uiRendererDataModel,
        model.a2uiRendererDataModel);
      const stale = {...defaults, parts: [...defaults.parts, {text: 'Host text', metadata: {
        ...defaults.metadata, a2uiRendererDataModel: {stale: true}, hostLabel: 'stay',
      }}]};
      const without = binding.encodeMessage(stale, {offerA2ui: false, rendererMetadata: model});
      assert.equal(readRendererCapabilities(without.metadata), undefined);
      assert.equal(without.metadata.a2uiRendererDataModel, undefined);
      assert.equal(without.parts.length, 1);
      assert.equal(readRendererCapabilities(without.parts[0].metadata), undefined);
      assert.deepEqual(without.parts[0].metadata, {hostLabel: 'stay'});
    }
    const oldCard = {capabilities: {extensions: [{
      uri: 'https://a2ui.org/a2a-extension/a2ui/v0.8', params: {acceptsInlineCatalogs: true},
    }]}};
    const old = createA2aBinding(renderer, {agentCard: oldCard, inlineCatalogIds: [basicCatalog.id]});
    assert.equal(readRendererCapabilities(old.encodeMessage({}).metadata)['1.0'].inlineCatalogs, undefined);
  } finally {
    renderer.dispose();
  }
});

test('the A2A binding round trips a browser action and its surface snapshot with the Agent SDK', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    try {
      await page.goto(origin + '/test-support/fixture-host.html');
      const request = await page.evaluate(() => window.fixture.a2a().encodeMessage({parts: [{text: 'Open study'}]}));
      const capabilities = readRendererCapabilities(request.metadata);
      const generator = new A2uiGenerator([new CatalogConfig(basicCatalog)], undefined, new DirectJsonFormatFactory());
      const processor = generator.createProcessor(capabilities);
      const state = processor.createState();
      const produce = payload => processor.parseResponse('<a2ui-json>' + JSON.stringify([payload]) + '</a2ui-json>',
        {state}).flatMap(part => part.a2ui ?? []);
      const create = produce({version: '1.0', createSurface: {
        surfaceId: 'study', catalogId: basicCatalog.id, sendDataModel: true, dataModel: {selected: 'weaver'},
        components: [{id: 'root', component: 'Button', child: 'label', action: {event: {name: 'select'}}},
          {id: 'label', component: 'Text', text: 'Open'}],
      }});
      const updateLabel = text => produce({version: '1.0', updateComponents: {
        surfaceId: 'study', components: [{id: 'label', component: 'Text', text}],
      }});
      assert.equal(create.length, 1);
      const initialUpdate = updateLabel('Select Weaver');
      assert.equal(initialUpdate.length, 1);
      const faults = await page.evaluate(({create, initialUpdate, mimeType}) => {
        const errors = [];
        window.fixture.a2a({onTransportError: error => errors.push(error.message)}).receiveParts([
          {data: {malformed: true}, metadata: {mimeType}},
          {data: [...create, {version: '1.0', invalid: {}}, ...initialUpdate], metadata: {mimeType}},
          {data: [{version: '1.0', deleteSurface: {surfaceId: 'study'}}], metadata: {mimeType: 'application/json'}},
        ]);
        return {errors, ingress: window.fixture.failures.splice(0)};
      }, {create, initialUpdate, mimeType});
      assert.equal(faults.errors.length, 1);
      assert.match(faults.errors[0], /array/);
      assert.equal(faults.ingress.length, 1);
      assert.match(faults.ingress[0], /invalid.*not supported/);

      await page.getByRole('button', {name: 'Select Weaver'}).click({timeout: 5000});
      const reply = await page.evaluate(() => {
        const {message, metadata} = window.fixture.outbound.shift();
        return window.fixture.a2a().encodeMessage({role: 'ROLE_USER'}, {envelope: message, rendererMetadata: metadata});
      });
      assert.deepEqual(readRendererCapabilities(reply.metadata), capabilities);
      assert.deepEqual(reply.metadata.a2uiRendererDataModel, {
        version: '1.0', surfaces: {study: {selected: 'weaver'}},
      });
      assert.equal(reply.parts[0].metadata.mimeType, mimeType);
      assert.equal(reply.parts[0].data.length, 1);
      const [envelope] = reply.parts[0].data;
      assertWireMessage(envelope, reply.metadata);
      const agent = new RendererToAgentMessageProcessor({
        catalogs: [basicCatalog],
        async onAction({action}) {
          assert.equal(action.name, 'select');
          const data = updateLabel('Weaver selected');
          assert.equal(data.length, 1);
          await page.evaluate(part => window.fixture.a2a().receiveParts([part]), {data, metadata: {mimeType}});
        },
      });
      assert.equal((await agent.processMessage(envelope)).handled, true);
      await page.getByRole('button', {name: 'Weaver selected'}).waitFor({timeout: 5000});
    } finally {
      await page.close();
    }
  });
});
