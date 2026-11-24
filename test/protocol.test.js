import assert from 'node:assert/strict';
import test from 'node:test';
import {setImmediate} from 'node:timers/promises';
import {Catalog, NodeResolver, getValue} from '@a2ui/web_core';
import {z} from 'zod';
import {assertWireMessage, assertWireCapabilities} from '../test-support/wire-check.js';
import {createProtocol, basicCatalog} from '../src/protocol.js';

const envelope = (kind, body) => ({version: '1.0', [kind]: body});

test('ordered JSONL preserves partial records and supports progressive surfaces', () => {
  const events = [];
  const sent = [];
  const transport = createProtocol({
    send: message => sent.push(message),
    onSurfaceCreated: surface => events.push(['create', surface.id]),
    onSurfaceDeleted: id => events.push(['delete', id]),
    onTransportError: () => events.push(['bad framing']),
  });
  try {
    const create = JSON.stringify(envelope('createSurface', {
      surfaceId: 'bench', catalogId: basicCatalog.id,
    }));
    const update = JSON.stringify(envelope('updateComponents', {
      surfaceId: 'bench', components: [{id: 'root', component: 'Text', text: 'Ready'}],
    }));
    const remove = JSON.stringify(envelope('deleteSurface', {surfaceId: 'bench'}));
    transport.receiveJsonl(create.slice(0, 10));
    assert.deepEqual(events, []);
    transport.receiveJsonl(create.slice(10) + '\ninvalid\n' + update + '\n' + remove);
    transport.finishJsonl();
    assert.deepEqual(events, [['create', 'bench'], ['bad framing'], ['delete', 'bench']]);
    assert.deepEqual(sent, []);
    const capabilities = transport.capabilities();
    assertWireCapabilities(capabilities);
    assert.deepEqual(capabilities, {'1.0': {supportedCatalogIds: [basicCatalog.id]}});
  } finally {
    transport.dispose();
  }
});

test('invalid RPC and missing surface use different wire errors', async () => {
  const sent = [];
  const transport = createProtocol({send: message => sent.push(message)});
  try {
    await transport.receive(envelope('callRendererFunction', {
      functionCallId: 'missing_catalog', callFunction: {'@call': 'required'},
    }));
    await transport.receive(envelope('callRendererFunction', {
      surfaceId: 'absent', functionCallId: 'missing_surface',
      callFunction: {'@call': 'required', catalogId: basicCatalog.id},
    }));
    assert.equal(sent.length, 2);
    for (const message of sent) assertWireMessage(message);
    assert.equal(sent[0].error.functionCallId, 'missing_catalog');
    assert.equal(sent[1].rendererFunctionResponse.functionCallId, 'missing_surface');
    assert.equal(sent[1].rendererFunctionResponse.error.code, 'INVALID_FUNCTION_CALL');
  } finally {
    transport.dispose();
  }
});

test('overlapping inbound RPC runs with its dispatch snapshot and retains exact correlation', async () => {
  const outstanding = new Map();
  let surface;
  const sent = [];
  const rpcCatalog = new Catalog('fixture-rpc', '1.0', [], [{
    name: 'park',
    returnType: 'string',
    allowedCallers: 'rendererOrAgent',
    schema: z.object({value: z.string()}),
    execute: ({value}) => new Promise(resolve => outstanding.set(value, resolve)),
  }]);
  const transport = createProtocol({
    catalogs: [basicCatalog, rpcCatalog],
    send: (message, metadata) => sent.push({message, metadata}),
    onSurfaceCreated: value => { surface = value; },
  });
  try {
    transport.receive(envelope('createSurface', {
      surfaceId: 'bench', catalogId: basicCatalog.id, sendDataModel: true, dataModel: {value: 'initial'},
    }));
    const write = value => transport.receive(envelope('updateDataModel', {surfaceId: 'bench', path: '/value', value}));
    const call = functionCallId => transport.receive(envelope('callRendererFunction', {
      surfaceId: 'bench', functionCallId,
      callFunction: {'@call': 'park', catalogId: rpcCatalog.id, args: {value: {'@path': '/value'}}},
    }));
    write('first');
    const first = call('first_id');
    write('second');
    const second = call('second_id');
    write('after-dispatch');
    await setImmediate();
    assert.deepEqual([...outstanding.keys()], ['first', 'second']);
    assert.equal(surface.dataModel.get('/value'), 'after-dispatch');
    outstanding.get('second')('second reply');
    await second;
    write('before-first-reply');
    outstanding.get('first')('first reply');
    await first;
    for (const {message, metadata} of sent) assertWireMessage(message, metadata);
    assert.deepEqual(sent.map(({message, metadata}) => [
      message.rendererFunctionResponse.functionCallId,
      message.rendererFunctionResponse.value,
      metadata.a2uiRendererDataModel.surfaces.bench.value,
    ]), [
      ['second_id', 'second reply', 'after-dispatch'],
      ['first_id', 'first reply', 'before-first-reply'],
    ]);
  } finally {
    transport.dispose();
  }
});

test('agent RPC returns eligible data to its own transport only', async () => {
  const fixtureCatalog = new Catalog('fixture-agent', '1.0', [], [{
    name: 'readLabel', returnType: 'string', schema: z.object({prefix: z.string().default('label')}),
  }]);
  const connect = label => {
    const output = [];
    let surface;
    let resolver;
    const transport = createProtocol({
      catalogs: [basicCatalog, fixtureCatalog],
      send: (message, metadata) => output.push({message, metadata}),
      onSurfaceCreated(model) {
        resolver?.dispose();
        surface = model;
        resolver = new NodeResolver(model);
      },
    });
    transport.receive(envelope('createSurface', {
      surfaceId: 'same_name_in_each_session',
      catalogId: basicCatalog.id,
      dataModel: {label},
      sendDataModel: true,
      components: [{id: 'root', component: 'Text', text: {
        '@call': 'readLabel', catalogId: fixtureCatalog.id,
      }}],
    }));
    getValue(resolver.rootNode).toJSON();
    return {output, transport, get surface() { return surface; },
      dispose() { resolver?.dispose(); transport.dispose(); }};
  };
  const first = connect('private alpha');
  const second = connect('private beta');
  try {
    await setImmediate();
    for (const [session, label] of [[first, 'private alpha'], [second, 'private beta']]) {
      assert.equal(session.output.length, 1);
      const [{message, metadata}] = session.output;
      assert.equal(message.callAgentFunction.callFunction.catalogId, fixtureCatalog.id);
      assert.deepEqual(message.callAgentFunction.callFunction.args, {prefix: 'label'});
      assert.deepEqual(metadata, {a2uiRendererDataModel: {version: '1.0', surfaces: {
        same_name_in_each_session: {label},
      }}});
    }
    const surfaceId = 'same_name_in_each_session';
    const {functionCallId} = first.output[0].message.callAgentFunction;
    first.transport.receive(envelope('updateDataModel', {
      surfaceId, path: '/label', value: 'edited alpha',
    }));
    assert.equal(first.output.length, 1);
    await first.transport.receive(envelope('agentFunctionResponse', {
      functionCallId, error: {code: 'EXECUTION_ERROR', message: 'Lookup failed'},
    }));
    await setImmediate();
    assert.equal(first.output.length, 2);
    assert.equal(second.output.length, 1);
    const {message, metadata} = first.output[1];
    assertWireMessage(message, metadata);
    assert.equal(message.error.functionCallId, functionCallId);
    assert.equal(message.error.code, 'EXPRESSION_ERROR');
    assert.deepEqual(metadata, {a2uiRendererDataModel: {version: '1.0', surfaces: {
      [surfaceId]: {label: 'edited alpha'},
    }}});
    assert.equal(first.output[0].metadata.a2uiRendererDataModel.surfaces[surfaceId].label, 'private alpha');

    const replacedCallId = second.output[0].message.callAgentFunction.functionCallId;
    second.surface.onError.subscribe(() => {
      second.transport.receive(envelope('deleteSurface', {surfaceId}));
      second.transport.receive(envelope('createSurface', {
        surfaceId, catalogId: basicCatalog.id, sendDataModel: true,
        dataModel: {label: 'replacement'},
      }));
    });
    await second.transport.receive(envelope('agentFunctionResponse', {
      functionCallId: replacedCallId, error: {code: 'EXECUTION_ERROR', message: 'Lookup failed'},
    }));
    await setImmediate();
    assert.equal(first.output.length, 2);
    assert.equal(second.output.length, 2);
    const stale = second.output[1];
    assertWireMessage(stale.message, stale.metadata);
    assert.equal(stale.message.error.functionCallId, replacedCallId);
    assert.deepEqual(stale.metadata, {});
    assert.equal(second.surface.dataModel.get('/label'), 'replacement');
  } finally {
    first.dispose();
    second.dispose();
  }
});

test('a renderer RPC from a removed surface cannot disclose a replacement surface', async () => {
  let finish;
  const received = [];
  const catalog = new Catalog('test-lifecycle', '1.0', [], [{
    name: 'waitForReply',
    returnType: 'string',
    allowedCallers: 'rendererOrAgent',
    schema: z.object({}),
    execute: () => new Promise(resolve => { finish = resolve; }),
  }]);
  const transport = createProtocol({
    catalogs: [catalog],
    send: (message, metadata) => received.push({message, metadata}),
  });
  const create = value => transport.receive(envelope('createSurface', {
    surfaceId: 'bench', catalogId: catalog.id, dataModel: {value}, sendDataModel: true,
  }));
  try {
    create('original');
    const reply = transport.receive(envelope('callRendererFunction', {
      surfaceId: 'bench', functionCallId: 'pre_deletion',
      callFunction: {'@call': 'waitForReply', catalogId: catalog.id},
    }));
    await setImmediate();
    assert.equal(typeof finish, 'function');
    transport.receive(envelope('deleteSurface', {surfaceId: 'bench'}));
    create('replacement');
    finish('complete');
    await reply;
    for (const {message, metadata} of received) assertWireMessage(message, metadata);
    assert.deepEqual(received, [{
      message: envelope('rendererFunctionResponse', {functionCallId: 'pre_deletion', value: 'complete'}),
      metadata: {},
    }]);
  } finally {
    transport.dispose();
  }
});
