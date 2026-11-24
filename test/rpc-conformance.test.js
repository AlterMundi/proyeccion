import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import test from 'node:test';
import {Catalog, DataContext, NodeResolver, getValue} from '@a2ui/web_core';
import {parse} from 'yaml';
import {z} from 'zod';
import {basicCatalog, createProtocol} from '../src/protocol.js';
import {record} from '../test-support/conformance-manifest.js';
import {assertWireMessage} from '../test-support/wire-check.js';
import {withBrowser} from '../test-support/browser.js';

const suite = 'core/rpc_functions.yaml';
const entries = parse(readFileSync(new URL('./fixtures/a2ui-v1/rpc_functions.yaml', import.meta.url), 'utf8'));
const basic = basicCatalog.copyWith({catalogId: 'basic'});
const skipped = new Map([
  ['test_rpc_call_renderer_function_requires_user_activation', 'The wire handler cannot supply browser activation to an agent message. A2UI 1.0 requires activation-gated functions to be rendererOnly.'],
  ['test_rpc_call_renderer_function_user_activation_denied', 'The fixture registers an activation-gated rendererOrAgent function. A2UI 1.0 requires rendererOnly. The catalog-registration test verifies both schema admission and a correlated denial with a valid function.'],
  ['test_rpc_call_renderer_function_protocol_version_mismatch', 'The renderer refuses mixed versions at registration.'],
  ['test_rpc_call_agent_function_duplicate_call_id_error', 'The renderer generates outgoing call identifiers and offers no caller-supplied ID.'],
  ['test_rpc_call_agent_function_no_listener', 'The fixture targets the SDK RPC port directly. A receive-only renderer does not attach that port to the surface; the routing corpus verifies the resulting local expression error.'],
]);

const implementations = {
  playMedia: () => ({playing: true, timestamp: 0}),
  openExternalUrl: () => ({opened: true}),
  syncState: () => null,
  internalStateReset: () => null,
  failingFunction: () => { throw new Error('An error occurred during function execution.'); },
  calculateTax: ({amount}) => amount * 0.1,
  echoArgs: args => Object.fromEntries(Object.entries(args).map(([key, value]) => [key, value ?? null])),
};

const frame = (kind, payload) => ({version: '1.0', [kind]: payload});

function connect(catalogs, agentFunctionTimeoutMs, maxAgentCallCacheEntries) {
  const surfaces = new Map();
  const outbound = [];
  const failures = [];
  const protocol = createProtocol({
    catalogs, agentFunctionTimeoutMs, maxAgentCallCacheEntries,
    send: (message, metadata) => {
      if (!message.callAgentFunction) assertWireMessage(message, metadata);
      outbound.push(message);
    },
    onTransportError: error => failures.push(error),
    onSurfaceCreated: surface => surfaces.set(surface.id, surface),
  });
  const create = async (surfaceId, catalogId, more = {}) => {
    await protocol.receive(frame('createSurface', {surfaceId, catalogId, ...more}));
    return surfaces.get(surfaceId);
  };
  return {protocol, outbound, failures, create};
}

function assertWireError(actual, expected) {
  assert.equal(actual.code, expected.code ?? 'INVALID_FUNCTION_CALL');
  assert.ok(actual.message.includes(expected.message), actual.message);
}

async function incoming(entry) {
  const {args, expect} = entry;
  const expected = expect.response?.rendererFunctionResponse;
  const namedCatalog = args.message.callRendererFunction?.callFunction?.catalogId;
  const id = expected?.error?.message.startsWith('Catalog not found:') ? 'basic' : (namedCatalog ?? 'basic');
  let executions = 0;
  const functions = Object.entries(args.functionMetadata ?? {}).map(([name, {parameters, ...policy}]) => ({
    name, ...policy, returnType: 'any',
    schema: parameters ? z.object({amount: z.number()}) : z.record(z.unknown()).default({}),
    execute: input => { executions++; return implementations[name](input); },
  }));
  const target = new Catalog(id, '1.0', [], functions);
  const {protocol, outbound, failures, create} = connect(id === 'basic' ? [target] : [basic, target]);
  try {
    if (args.surfaceId) await create(args.surfaceId, id, {dataModel: args.dataModel});
    await protocol.receive(args.message);
    await setImmediate();
    assert.deepEqual(failures, []);
    if (expect.response === null) {
      assert.deepEqual(outbound, []);
      return;
    }
    assert.equal(outbound.length, 1, JSON.stringify(outbound));
    const [actual] = outbound;
    assertWireMessage(actual);
    if (expect.error) {
      assert.equal(actual.error.functionCallId, expect.error.functionCallId ?? args.message.callRendererFunction.functionCallId);
      assertWireError(actual.error, expect.error);
      assert.equal(executions, 0);
    } else {
      const response = actual.rendererFunctionResponse;
      assert.equal(response.functionCallId, expected.functionCallId);
      if (expected.error) {
        assertWireError(response.error, expected.error);
        assert.equal(executions, expected.error.message === 'An error occurred during function execution.' ? 1 : 0);
      } else {
        assert.deepEqual(response.value, expected.value);
        assert.equal(executions, 1);
      }
    }
  } finally {
    protocol.dispose();
  }
}

function publishedCall(messages, expected) {
  assert.equal(messages.length, 1, JSON.stringify(messages));
  const [message] = messages.splice(0);
  const {functionCallId, ...call} = message.callAgentFunction;
  assert.deepEqual({...message, callAgentFunction: call}, expected);
  assert.ok(typeof functionCallId === 'string' && functionCallId.length);
  return functionCallId;
}

async function outgoing(entry) {
  const {args, expect, expectError} = entry;
  const {surfaceId, callFunction, timeoutMs} = args.outboundCall;
  const catalog = basic.copyWith({catalogId: callFunction.catalogId});
  const {protocol, outbound, failures, create} = connect([catalog], timeoutMs);
  try {
    const surface = await create(surfaceId, catalog.id);
    const result = surface.callAgentFunction(callFunction);
    const rejected = expectError && assert.rejects(result, {
      code: expect?.inFlightError?.code ?? expectError.code,
    });
    await setImmediate();
    const id = publishedCall(outbound, frame('callAgentFunction', {surfaceId, callFunction}));
    const respond = async inbound => {
      const {functionCallId, ...payload} = inbound.agentFunctionResponse;
      assert.equal(functionCallId, expect?.correlatedCallId ?? args.outboundCall.functionCallId);
      await protocol.receive(frame('agentFunctionResponse', {...payload, functionCallId: id}));
    };
    if (args.afterCall === 'dispose') {
      protocol.dispose();
      assert.equal(surface.disposed, true);
    } else if (args.afterCall === 'cancel') {
      await protocol.receive(frame('deleteSurface', {surfaceId}));
      assert.equal(surface.disposed, true);
    }
    if (rejected) await rejected;
    else {
      await respond(args.inboundResponse);
      assert.deepEqual(await result, expect.result);
    }
    if (args.lateInboundResponse) {
      assert.equal(expect.lateResponseIgnored, true);
      await respond(args.lateInboundResponse);
    }
    await setImmediate();
    assert.deepEqual(outbound, []);
    assert.deepEqual(failures, []);
  } finally {
    protocol.dispose();
  }
}

test('a renderer function request cannot execute without a return channel', async () => {
  const failures = [];
  let executions = 0;
  const catalog = new Catalog('receive-only', '1.0', [], [{
    name: 'apply', allowedCallers: 'agentOnly', returnType: 'void', schema: z.object({}),
    execute() { executions++; },
  }]);
  const protocol = createProtocol({catalogs: [catalog], onTransportError: error => failures.push(error)});
  try {
    await protocol.receive(frame('callRendererFunction', {
      functionCallId: 'write', callFunction: {'@call': 'apply', catalogId: catalog.id, args: {}},
    }));
    assert.equal(executions, 0);
    assert.deepEqual(failures.map(({code, functionCallId}) => ({code, functionCallId})),
      [{code: 'NO_LISTENER', functionCallId: 'write'}]);
  } finally {
    protocol.dispose();
  }
});

test('agent RPC result preserves arbitrary JSON with literal path keys', async () => {
  const {protocol, outbound, failures, create} = connect([basic]);
  const literal = {path: 'display~2', '@path': 'also literal~2'};
  try {
    const surface = await create('rpc', basic.id);
    const result = surface.callAgentFunction({'@call': 'queryDocument', catalogId: basic.id});
    await setImmediate();
    assert.equal(outbound.length, 1);
    const [{callAgentFunction: {functionCallId}}] = outbound.splice(0);
    await protocol.receive(frame('agentFunctionResponse', {functionCallId, value: literal}));
    assert.deepEqual(await result, literal);
    assert.deepEqual(outbound, []);
    assert.deepEqual(failures, []);
  } finally {
    protocol.dispose();
  }
});

async function ui(entry) {
  const {args, expect} = entry;
  const binding = args.uiBindingScenario;
  const scenario = binding ?? args.uiActionFallbackScenario;
  const functions = Object.entries(scenario.localFunctions ?? {}).map(([name, fn]) => ({
    name, returnType: fn.returnType, schema: z.object({}).passthrough(),
    execute(_, {dataModel}) {
      const {path, value} = fn.effect.setData;
      dataModel.set(path, value);
      return value;
    },
  }));
  const catalog = basic.copyWith({catalogId: scenario.catalogId, functions});
  const {protocol, outbound, failures, create} = connect([catalog]);
  let resolver;
  try {
    const surface = await create(scenario.surfaceId, catalog.id, binding ? {
      components: binding.components ?? [binding.component],
    } : {});
    let result;
    const nodes = new Map();
    if (binding) {
      resolver = new NodeResolver(surface);
      function visit(node) {
        nodes.set(node.componentId, node);
        for (const child of getValue(node.props).children ?? []) visit(child);
      }
      visit(getValue(resolver.rootNode));
    } else {
      result = new DataContext(surface, '/').resolveAction(scenario.actionPayload);
    }
    const props = () => getValue(nodes.get(binding.observe?.componentId ?? binding.component?.id ?? 'root').props);
    const value = (nodeProps, key) => key === 'text'
      ? (nodeProps.text?.value ?? null) : nodeProps[key];
    const readValue = () => value(props(), binding.observe?.property ?? 'text');
    if ('initialValue' in expect) assert.deepEqual(readValue(), expect.initialValue);
    await setImmediate();
    const functionCallId = publishedCall(outbound, expect.outboundCall);
    const response = scenario.inboundResponseError
      ? {error: scenario.inboundResponseError} : {value: scenario.inboundResponseValue};
    await protocol.receive(frame('agentFunctionResponse', {functionCallId, ...response}));
    const actionResult = await result;
    await setImmediate();
    if ('resolvedValue' in expect) assert.deepEqual(readValue(), expect.resolvedValue);
    if ('result' in expect) assert.deepEqual(actionResult, expect.result);
    for (const [id, fields] of Object.entries(expect.siblings ?? {})) {
      for (const [key, expected] of Object.entries(fields)) {
        assert.deepEqual(value(getValue(nodes.get(id).props), key), expected);
      }
    }
    if (expect.validationResult) {
      assert.deepEqual(props().validationResults, [expect.validationResult]);
      assert.equal(props().isValid, false);
    }
    if (expect.dataModel) assert.deepEqual(surface.dataModel.get('/'), expect.dataModel);
    if (expect.surfaceError) {
      assert.equal(outbound.length, 1);
      const [{error}] = outbound;
      assert.equal(error.code, expect.surfaceError.code);
      assert.equal(error.functionCallId, functionCallId);
      assert.equal(error.surfaceId, undefined);
    } else assert.deepEqual(outbound, []);
    assert.deepEqual(failures, []);
  } finally {
    resolver?.dispose();
    protocol.dispose();
  }
}

for (const entry of entries) {
  if (skipped.has(entry.name)) {
    record(suite, entry.name, 'skipped', skipped.get(entry.name));
    continue;
  }
  test(entry.name, async () => {
    try {
      assert.equal(entry.action, 'handle_rpc');
      if (entry.args.message) await incoming(entry);
      else if (entry.args.outboundCall) await outgoing(entry);
      else await ui(entry);
      record(suite, entry.name, 'passed');
    } catch (error) {
      record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
      throw error;
    }
  });
}

for (const asynchronous of [false, true]) {
  test('agent action stops when its transport ' + (asynchronous ? 'rejects' : 'throws'), async () => {
    const catalog = new Catalog('delivery', '1.0', [], [{
      name: 'apply', returnType: 'boolean', schema: z.object({valid: z.boolean()}),
      execute({valid}, {dataModel}) { dataModel.set('/applied', valid); return valid; },
    }]);
    const sent = [];
    const failures = [];
    const unavailable = new Error('offline transport fixture');
    let surface;
    const session = createProtocol({
      catalogs: [catalog],
      onSurfaceCreated: model => { surface = model; },
      onTransportError: error => failures.push(error),
      send(message) {
        sent.push(message);
        if (!message.callAgentFunction) return;
        if (asynchronous) return Promise.reject(unavailable);
        throw unavailable;
      },
    });
    try {
      await session.receive(frame('createSurface', {surfaceId: 's', catalogId: catalog.id}));
      const action = {functionCall: {'@call': 'apply', args: {valid: {'@call': 'checkPermission'}}}};
      const pending = new DataContext(surface, '/').resolveAction(action);
      await setImmediate();
      assert.equal(await pending, undefined);
      assert.deepEqual(surface.dataModel.get('/'), {});
      assert.deepEqual(failures, [unavailable]);
      assert.equal(sent.length, 2);
      const [call, diagnostic] = sent;
      assertWireMessage(diagnostic);
      assert.equal(diagnostic.error.code, 'EXPRESSION_ERROR');
      assert.equal(diagnostic.error.functionCallId, call.callAgentFunction.functionCallId);
      assert.match(diagnostic.error.message, /Could not deliver the agent function call/);
      await session.receive(frame('agentFunctionResponse', {
        functionCallId: call.callAgentFunction.functionCallId, value: true,
      }));
      assert.deepEqual(surface.dataModel.get('/'), {});
      assert.equal(sent.length, 2);
    } finally {
      session.dispose();
    }
  });
}

test('concurrent RPC argument failures stay with their calls while view errors still reach the agent', async () => {
  const pending = new Map();
  const catalog = new Catalog('async-arguments', '1.0', [], [{
    name: 'read', returnType: 'string', allowedCallers: 'rendererOrAgent',
    schema: z.object({value: z.string()}),
    execute: () => assert.fail('The outer function must not execute'),
  }, {
    name: 'load', returnType: 'string', schema: z.object({key: z.string()}),
    execute({key}) {
      return new Promise((_, reject) => { pending.set(key, reject); });
    },
  }]);
  const {protocol, outbound, failures, create} = connect([catalog]);
  let binding;
  const errorMessage = 'Async argument failed';
  const lookup = key => ({'@call': 'load', args: {key}});
  try {
    const surface = await create('s', catalog.id);
    const invoke = key => protocol.receive(frame('callRendererFunction', {
      surfaceId: 's', functionCallId: key,
      callFunction: {'@call': 'read', catalogId: catalog.id, args: {value: lookup(key)}},
    }));
    const first = invoke('first');
    const second = invoke('second');
    binding = new DataContext(surface, '/').subscribeDynamicValue(lookup('view'), () => {});
    await setImmediate();
    assert.deepEqual([...pending.keys()], ['first', 'second', 'view']);

    pending.get('view')(new Error(errorMessage));
    await setImmediate();
    assert.deepEqual(outbound, [frame('error', {
      code: 'EXPRESSION_ERROR', surfaceId: 's', message: errorMessage,
    })]);

    pending.get('second')(new Error(errorMessage));
    await second;
    pending.get('first')(new Error(errorMessage));
    await first;
    await setImmediate();
    assert.deepEqual(outbound.slice(1), ['second', 'first'].map(functionCallId =>
      frame('rendererFunctionResponse', {functionCallId, error: {code: 'EXECUTION_ERROR', message: errorMessage}})));
    assert.deepEqual(failures, []);
  } finally {
    binding?.unsubscribe();
    protocol.dispose();
  }
});

for (const [framing, dispatch] of [
  ['JSONL', (session, messages) => session.receiveJsonl(messages.map(message => JSON.stringify(message)).join('\n') + '\n')],
  ['batch', (session, messages) => session.receiveBatch(messages)],
]) {
  test(framing + ' dispatch observes preceding writes and keeps later writes moving during renderer RPC', async () => {
    let complete;
    const pending = new Promise(resolve => { complete = resolve; });
    const observed = [];
    const catalog = new Catalog('fixture/ordering', '1.0', [], [{
      name: 'reportRevision', allowedCallers: 'rendererOrAgent', returnType: 'number',
      schema: z.object({revision: z.number()}),
      async execute({revision}) {
        observed.push(revision);
        await pending;
        return revision;
      },
    }]);
    const {protocol, outbound, failures, create} = connect([catalog]);
    const surfaceId = 'ordered';
    const update = value => frame('updateDataModel', {surfaceId, path: '/revision', value});
    try {
      const surface = await create(surfaceId, catalog.id, {dataModel: {revision: 0}});
      const call = frame('callRendererFunction', {surfaceId, functionCallId: 'ordered_call',
        callFunction: {'@call': 'reportRevision', catalogId: catalog.id, args: {revision: {'@path': '/revision'}}},
      });
      const dispatched = dispatch(protocol, [update(1), call, update(2)]);
      await setImmediate();
      assert.deepEqual(observed, [1]);
      assert.equal(surface.dataModel.get('/revision'), 2);
      assert.deepEqual(outbound, []);

      complete();
      await dispatched;
      await setImmediate();
      assert.deepEqual(outbound, [frame('rendererFunctionResponse', {functionCallId: 'ordered_call', value: 1})]);
      assert.deepEqual(failures, []);
    } finally {
      complete();
      protocol.dispose();
    }
  });
}

test('declared agent RPC fills defaults and resumes its action after preceding JSONL updates', async () => {
  const applied = [];
  const catalog = new Catalog('fixture/agent-ordering', '1.0', [], [
    {
      name: 'lookup', returnType: 'string', allowedCallers: 'rendererOnly',
      schema: z.object({subject: z.string(), locale: z.string().default('es')}),
    },
    {
      name: 'apply', returnType: 'void',
      schema: z.object({value: z.string()}),
      execute({value}, {dataModel}) {
        applied.push([value, dataModel.get('/revision')]);
      },
    },
  ]);
  const {protocol, outbound, failures, create} = connect([catalog]);
  const surfaceId = 'agent_ordered';
  try {
    const surface = await create(surfaceId, catalog.id, {dataModel: {subject: 'weaver', revision: 0}});
    const action = new DataContext(surface, '/').resolveAction({
      functionCall: {'@call': 'apply', args: {
        value: {'@call': 'lookup', args: {subject: {'@path': '/subject'}}},
      }},
    });
    await setImmediate();
    assert.deepEqual(applied, []);
    const functionCallId = publishedCall(outbound, frame('callAgentFunction', {
      surfaceId, callFunction: {'@call': 'lookup', catalogId: catalog.id, args: {subject: 'weaver', locale: 'es'}},
    }));
    const messages = [
      frame('updateDataModel', {surfaceId, path: '/revision', value: 1}),
      frame('agentFunctionResponse', {functionCallId, value: 'ready'}),
      frame('agentFunctionResponse', {functionCallId, value: 'stale duplicate'}),
    ];
    protocol.receiveJsonl(messages.map(message => JSON.stringify(message)).join('\n') + '\n');
    await action;
    assert.deepEqual(applied, [['ready', 1]]);
    assert.deepEqual(outbound, []);
    assert.deepEqual(failures, []);
  } finally {
    protocol.dispose();
  }
});

test('malformed agent responses leave the same call pending for a valid null result', async () => {
  const {protocol, outbound, failures, create} = connect([basic]);
  try {
    const surface = await create('pending_reply', basic.id);
    const answer = surface.callAgentFunction({'@call': 'read', catalogId: basic.id, args: {}});
    await setImmediate();
    const functionCallId = publishedCall(outbound, frame('callAgentFunction', {
      surfaceId: surface.id, callFunction: {'@call': 'read', catalogId: basic.id, args: {}},
    }));
    const invalid = [
      {},
      {error: null},
      {value: 'Invalid result', error: {code: 'ERROR', message: 'Two outcomes'}},
    ];
    for (const response of invalid) {
      await protocol.receive(frame('agentFunctionResponse', {functionCallId, ...response}));
      assert.equal(outbound.length, 1);
      const [{error}] = outbound.splice(0);
      assert.equal(error.code, 'INVALID_FUNCTION_CALL');
      assert.equal(error.functionCallId, functionCallId);
    }
    await protocol.receive(frame('agentFunctionResponse', {functionCallId, value: null}));
    assert.equal(await answer, null);
    assert.deepEqual(outbound, []);
    assert.deepEqual(failures, []);
  } finally {
    protocol.dispose();
  }
});

test('reactive agent answers are isolated, copied, retried on failure and evicted at the host limit', async () => {
  const {protocol, outbound, failures, create} = connect([basic], undefined, 1);
  const call = (surface, args) => surface.callAgentFunction({'@call': 'read', catalogId: basic.id, args});
  const take = async () => {
    await setImmediate();
    assert.equal(outbound.length, 1);
    return outbound.shift().callAgentFunction;
  };
  const reply = async (request, payload) => protocol.receive(frame('agentFunctionResponse', {
    functionCallId: request.functionCallId, ...payload,
  }));
  try {
    const primary = await create('primary', basic.id);
    const separate = await create('separate', basic.id);
    const args = {detail: true, name: 'fixture'};
    const first = call(primary, args);
    const shared = call(primary, {name: 'fixture', detail: true});
    const request = await take();
    assert.equal(request.surfaceId, 'primary');
    await reply(request, {value: {nested: {value: 'original'}}});
    const [original, copied] = await Promise.all([first, shared]);
    original.nested.value = 'mutated';
    assert.equal(copied.nested.value, 'original');
    assert.deepEqual(await call(primary, args), copied);
    assert.deepEqual(outbound, []);

    const isolated = call(separate, args);
    const isolatedRequest = await take();
    assert.equal(isolatedRequest.surfaceId, 'separate');
    await reply(isolatedRequest, {value: 'separate answer'});
    assert.equal(await isolated, 'separate answer');

    const next = call(primary, {name: 'other'});
    await reply(await take(), {value: 'other answer'});
    assert.equal(await next, 'other answer');
    const evicted = call(primary, args);
    const rejected = assert.rejects(evicted, {code: 'INVALID_FUNCTION_CALL'});
    const failed = await take();
    await reply(failed, {error: {code: 'INVALID_FUNCTION_CALL', message: 'Fixture rejection'}});
    await rejected;

    const retried = call(primary, args);
    const retry = await take();
    assert.notEqual(retry.functionCallId, failed.functionCallId);
    await reply(retry, {value: 'fresh answer'});
    assert.equal(await retried, 'fresh answer');

    await protocol.receive(frame('deleteSurface', {surfaceId: 'primary'}));
    const replacement = await create('primary', basic.id);
    const fresh = call(replacement, args);
    await reply(await take(), {value: 'replacement answer'});
    assert.equal(await fresh, 'replacement answer');
    assert.deepEqual(await call(separate, args), 'separate answer');
    assert.deepEqual(outbound, []);
    assert.deepEqual(failures, []);
  } finally {
    protocol.dispose();
  }
});

test('mounted bindings can share one request or request separate current values', async () => {
  const catalogId = 'fixture/reactive';
  await withBrowser(async (browser, origin) => {
    for (const maxAgentCallCacheEntries of [undefined, 0]) {
      const page = await browser.newPage();
      try {
        await page.goto(origin + '/test-support/fixture-host.html');
        await page.evaluate(({basicId, catalogId, maxAgentCallCacheEntries}) => {
          const {fixture} = window;
          fixture.configure({maxAgentCallCacheEntries, secondary: [{
            catalogId, protocolVersion: '1.0',
            functions: {lookupAccount: {returnType: 'string', allowedCallers: 'rendererOrAgent'}},
          }]});
          const text = {'@call': 'lookupAccount', catalogId, args: {accountId: 'same'}};
          fixture.projection.receive({version: '1.0', createSurface: {
            surfaceId: 'reactive', catalogId: basicId,
            components: [
              {id: 'root', component: 'Column', children: ['left', 'right']},
              {id: 'left', component: 'Text', text},
              {id: 'right', component: 'Text', text},
            ],
          }});
        }, {basicId: basicCatalog.id, catalogId, maxAgentCallCacheEntries});
        const count = maxAgentCallCacheEntries === 0 ? 2 : 1;
        await page.waitForFunction(count => window.fixture.outbound.length === count, count, {timeout: 5000});
        const messages = await page.evaluate(() => window.fixture.outbound.splice(0).map(row => row.message));
        const requests = messages.map(message => {
          assert.ok(message.callAgentFunction, JSON.stringify(message));
          return message.callAgentFunction;
        });
        assert.equal(new Set(requests.map(request => request.functionCallId)).size, count);
        assert.ok(requests.every(request => request.surfaceId === 'reactive' && request.callFunction.args.accountId === 'same'));
        await page.evaluate(requests => requests.forEach(({functionCallId}, index) => {
          window.fixture.projection.receive({version: '1.0',
            agentFunctionResponse: {functionCallId, value: 'Answer ' + (index + 1)}});
        }), requests);
        if (count === 1) await page.waitForFunction(() =>
          document.querySelector('a2ui-surface').textContent.match(/Answer 1/g)?.length === 2, null, {timeout: 5000});
        else {
          await page.getByText('Answer 1', {exact: true}).waitFor({timeout: 5000});
          await page.getByText('Answer 2', {exact: true}).waitFor({timeout: 5000});
        }
        assert.deepEqual(await page.evaluate(() => [window.fixture.outbound, window.fixture.failures]), [[], []]);
      } finally {
        await page.close();
      }
    }
  });
});
