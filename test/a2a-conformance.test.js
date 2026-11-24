import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {AgentCard, Extensions, Message, SendMessageRequest} from '@a2a-js/sdk';
import {ClientFactory} from '@a2a-js/sdk/client';
import {DefaultRequestHandler, InMemoryTaskStore, JsonRpcTransportHandler, ServerCallContext} from '@a2a-js/sdk/server';
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
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('text turns carry fresh synchronized data and omit deleted, private and other-session surfaces', async () => {
  const renderer = createProtocol({});
  const other = createProtocol({});
  const create = (receiver, surfaceId, sendDataModel) => receiver.receive({version: '1.0', createSurface: {
    surfaceId, catalogId: basicCatalog.id, sendDataModel, dataModel: {nested: {value: 'original'}},
  }});
  try {
    const binding = createA2aBinding(renderer);
    assert.equal(binding.encodeMessage({}).metadata.a2uiRendererDataModel, undefined);
    await create(renderer, 'shared', true);
    await create(renderer, 'private', false);
    await create(renderer, 'removed', true);
    await create(other, 'another_session', true);
    await renderer.receive({version: '1.0', deleteSurface: {surfaceId: 'removed'}});
    const text = {parts: [{text: 'Read the selection'}]};
    const first = binding.encodeMessage(text).metadata.a2uiRendererDataModel;
    assert.deepEqual(first, {version: '1.0', surfaces: {shared: {nested: {value: 'original'}}}});
    first.surfaces.shared.nested.value = 'detached';
    assert.equal(binding.encodeMessage(text).metadata.a2uiRendererDataModel.surfaces.shared.nested.value, 'original');
    assert.equal(binding.encodeMessage(text, {offerA2ui: false}).metadata.a2uiRendererDataModel, undefined);
    const envelope = {version: '1.0', rendererFunctionResponse: {functionCallId: 'old', value: null}};
    assert.equal(binding.encodeMessage({}, {envelope}).metadata.a2uiRendererDataModel, undefined);
    renderer.dispose();
    assert.equal(binding.encodeMessage(text).metadata.a2uiRendererDataModel, undefined);
  } finally {
    renderer.dispose();
    other.dispose();
  }
});

test('an official A2A JSON-RPC client and server carry text, mounted actions and scoped A2UI state', {timeout: 25000}, async () => {
  const turns = [];
  const updates = {
    open: {version: '1.0', createSurface: {
      surfaceId: 'study', catalogId: basicCatalog.id, sendDataModel: true, dataModel: {selection: 'original'},
      components: [
        {id: 'root', component: 'Column', children: ['edit', 'submit']},
        {id: 'edit', component: 'TextField', label: 'Selection', value: {'@path': '/selection'}},
        {id: 'submit', component: 'Button', child: 'label', action: {event: {name: 'confirm'}}},
        {id: 'label', component: 'Text', text: 'Confirm'},
      ],
    }},
    confirm: {version: '1.0', updateComponents: {
      surfaceId: 'study', components: [{id: 'label', component: 'Text', text: 'Confirmed'}],
    }},
  };
  const plugin = {
    name: 'a2a-sdk-fixture',
    configureServer(server) {
      let transport;
      const card = () => AgentCard.fromJSON({
        name: 'A2UI test agent', description: 'A loopback protocol fixture', version: '1.0',
        supportedInterfaces: [{
          url: 'http://127.0.0.1:' + server.httpServer.address().port + '/fixture-a2a',
          protocolBinding: 'JSONRPC', protocolVersion: '1.0',
        }],
        capabilities: {extensions: [{uri: A2UI_A2A_EXTENSION, params: {acceptsInlineCatalogs: true}}]},
        defaultInputModes: ['text/plain', mimeType], defaultOutputModes: ['text/plain', mimeType],
      });
      server.middlewares.use('/.well-known/agent-card.json', (_, response) => {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(AgentCard.toJSON(card())));
      });
      server.middlewares.use('/fixture-a2a', async (request, response) => {
        let body = '';
        for await (const chunk of request.setEncoding('utf8')) body += chunk;
        const context = new ServerCallContext({
          requestedVersion: request.headers['a2a-version'],
          requestedExtensions: Extensions.parseServiceParameter(request.headers['a2a-extensions']),
        });
        transport ??= new JsonRpcTransportHandler(new DefaultRequestHandler(card(), new InMemoryTaskStore(), {
          async execute({userMessage, context, contextId}, bus) {
            const message = Message.toJSON(userMessage);
            const capabilities = readRendererCapabilities(message.metadata);
            const envelope = message.parts.find(part => part.metadata?.mimeType === mimeType)?.data[0];
            const text = message.parts.find(part => part.text)?.text;
            turns.push({message, capabilities, envelope, extensions: context.requestedExtensions,
              version: context.requestedVersion});
            const update = capabilities?.['1.0'] && updates[envelope?.action?.name ?? text];
            const parts = update ? [{mediaType: mimeType, metadata: {mimeType}, data: [update]}] : [{text: 'Acknowledged'}];
            bus.publish({kind: 'message', data: Message.fromJSON({
              messageId: randomUUID(), contextId, role: 'ROLE_AGENT', parts,
            })});
            bus.finished();
          },
          async cancelTask() {},
        }));
        const reply = await transport.handle(body, context);
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify(reply));
      });
    },
  };
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    try {
      const card = await (await fetch(origin + '/.well-known/agent-card.json')).json();
      const client = await new ClientFactory().createFromUrl(origin);
      await page.goto(origin + '/test-support/fixture-host.html');
      let contextId;
      const send = async (text, {activate = false, offerA2ui = true, action = false} = {}) => {
        const {message, headers} = await page.evaluate(({text, activate, offerA2ui, action, card, contextId}) => {
          const {fixture} = window;
          const a2a = fixture.a2a({agentCard: card, inlineCatalogIds: fixture.projection.capabilities()['1.0'].supportedCatalogIds});
          const {message: envelope, metadata: rendererMetadata} = action ? fixture.outbound.shift() : {};
          const message = a2a.encodeMessage({
            messageId: crypto.randomUUID(), contextId, role: 'ROLE_USER', parts: text ? [{text}] : [],
          }, {offerA2ui, envelope, rendererMetadata});
          return {message, headers: a2a.headers({activate})};
        }, {text, activate, offerA2ui, action, card, contextId});
        const reply = await client.sendMessage(SendMessageRequest.fromJSON({message}), {
          serviceParameters: headers, signal: AbortSignal.timeout(5000),
        });
        assert.ok(reply.parts);
        contextId = reply.contextId;
        await page.evaluate(parts => window.fixture.a2a().receiveParts(parts), reply.parts);
        return reply;
      };
      const opened = await send('open');
      assert.equal(opened.parts[0].content.$case, 'data');
      assert.deepEqual(await page.evaluate(() => window.fixture.outbound), []);
      const field = page.getByRole('textbox', {name: 'Selection'});
      assert.equal(await field.inputValue({timeout: 5000}), 'original');
      await field.fill('updated');
      await send('inspect');
      const plain = await send('plain', {activate: true, offerA2ui: false});
      assert.equal(plain.parts[0].content.$case, 'text');
      await page.getByRole('button', {name: 'Confirm'}).click();
      await send(undefined, {activate: true, action: true});
      await page.getByRole('button', {name: 'Confirmed'}).waitFor({timeout: 5000});
      assert.deepEqual(turns.map(turn => turn.version), ['1.0', '1.0', '1.0', '1.0']);
      assert.deepEqual(turns.slice(1).map(turn => turn.message.contextId), Array(3).fill(opened.contextId));
      assert.deepEqual(turns.map(turn => turn.extensions ?? []), [[], [], [A2UI_A2A_EXTENSION], [A2UI_A2A_EXTENSION]]);
      assert.deepEqual(turns[0].capabilities['1.0'].inlineCatalogs.map(catalog => catalog.catalogId), [basicCatalog.id]);
      assert.equal(turns[0].message.metadata.a2uiRendererDataModel, undefined);
      for (const turn of [turns[1], turns[3]]) {
        assert.equal(turn.capabilities['1.0'].supportedCatalogIds[0], basicCatalog.id);
        assert.deepEqual(turn.message.metadata.a2uiRendererDataModel,
          {version: '1.0', surfaces: {study: {selection: 'updated'}}});
      }
      assert.equal(turns[2].capabilities, undefined);
      assert.equal(turns[2].message.metadata?.a2uiRendererDataModel, undefined);
      assertWireMessage(turns[3].envelope, turns[3].message.metadata);
      assert.equal(turns[3].envelope.action.name, 'confirm');
      assert.deepEqual(await page.evaluate(() => window.fixture.failures), []);
    } finally {
      await page.close();
    }
  }, process.env.PROYECCION_BROWSER_PROJECT, [plugin]);
});
