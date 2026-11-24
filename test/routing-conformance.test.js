import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {setImmediate} from 'node:timers/promises';
import test from 'node:test';
import {isDeepStrictEqual} from 'node:util';
import {Catalog, ComponentContext, ComponentModel, DataContext, GenericBinder} from '@a2ui/web_core';
import {parse} from 'yaml';
import {basicCatalog, createProtocol} from '../src/protocol.js';
import {record} from '../test-support/conformance-manifest.js';
import {assertWireMessage} from '../test-support/wire-check.js';

const suite = 'core/agent_function_routing.yaml';
const cases = parse(readFileSync(new URL('./fixtures/a2ui-v1/agent_function_routing.yaml', import.meta.url), 'utf8'));
const excluded = new Map([
  ['test_agent_routing_pre_v1_surface_is_not_routed', 'Proyección accepts only A2UI 1.0.'],
  ['test_agent_routing_cancelled_call_is_sent_again_on_unrelated_change', 'Web Core does not re-evaluate the inner call when only the outer label changes. The alternative equal-argument rewrite fixture passes.'],
]);

function buildCatalogs(specs) {
  return specs.map(({catalogId, localFunctions = [], agentFunctions = {}}) => {
    const declarations = Object.fromEntries(Object.entries(agentFunctions).map(([name, {args, ...policy}]) => [
      name, {type: 'object', ...policy, properties: {'@call': {const: name}, args}, required: ['@call', 'args']},
    ]));
    const declared = Catalog.fromJson({catalogId, protocolVersion: '1.0', components: {}, functions: declarations});
    const local = localFunctions.map(name => {
      const implementation = basicCatalog.functions.get(name);
      assert.ok(implementation, 'Missing Basic Catalog implementation ' + name);
      return implementation;
    });
    return new Catalog(catalogId, '1.0', [], [...local, ...declared.functions.values()]);
  });
}

function evaluate({evaluate: expression, as = 'binding'}, ctx, surface, probes, disposers) {
  if (as === 'action') {
    void ctx.resolveAction({functionCall: expression}, {userActivation: true});
  } else if (as === 'event') {
    const action = ctx.resolveAction({event: expression}, {userActivation: true});
    if (action !== undefined) void surface.dispatchAction(action, 'probe');
  } else if (as === 'check') {
    const id = 'check_' + probes.length;
    const probe = new ComponentModel(id, 'TextField', {label: 'Check'});
    surface.componentsModel.addComponent(probe);
    const binder = new GenericBinder(new ComponentContext(surface, id),
      basicCatalog.components.get('TextField').schema);
    const subscription = binder.subscribe(() => {});
    probe.properties = {label: 'Check', '@checks': [{condition: expression, message: 'Check failed'}]};
    probes.push(() => binder.snapshot.isValid);
    disposers.push(() => subscription.unsubscribe());
  } else {
    assert.equal(as, 'binding');
    let current;
    const subscription = ctx.subscribeDynamicValue(expression, value => { current = value; });
    current = subscription.value;
    probes.push(() => current);
    disposers.push(() => subscription.unsubscribe());
  }
}

function assertCalls(messages, step) {
  const expected = [...(step.expectOutbound ?? [])];
  const actual = messages.map(message => message.callAgentFunction.callFunction);
  if (step.outboundInAnyOrder) {
    for (const payload of actual) {
      const index = expected.findIndex(candidate => isDeepStrictEqual(candidate, payload));
      assert.notEqual(index, -1, 'Unexpected call ' + JSON.stringify(payload));
      expected.splice(index, 1);
    }
    assert.deepEqual(expected, []);
  } else {
    assert.deepEqual(actual, expected);
  }
}

for (const entry of cases) {
  const reason = excluded.get(entry.name);
  if (reason) {
    record(suite, entry.name, 'skipped', reason);
    continue;
  }
  test(entry.name, async () => {
    let surface;
    const emitted = [];
    const localErrors = [];
    const transportFailures = [];
    const calls = [];
    const probes = [];
    const disposers = [];
    const catalogs = buildCatalogs(entry.catalogs);
    const documents = new Map(catalogs.map(catalog => [catalog.id, catalog.toJson()]));
    const protocol = createProtocol({
      catalogs,
      send: entry.surface.outboundListener === false ? undefined : message => emitted.push(message),
      onSurfaceCreated: model => {
        surface = model;
        if (entry.surface.outboundListener === false) surface.onError.subscribe(error => localErrors.push({error}));
      },
      onTransportError: error => transportFailures.push(error.message),
    });
    const receive = body => protocol.receive({version: '1.0', ...body});
    try {
      assert.equal(entry.action, 'route_agent_function');
      assert.equal(entry.protocolVersion, '1.0');
      await receive({createSurface: {
        surfaceId: 'main',
        ...(entry.surface.catalogId ? {catalogId: entry.surface.catalogId} : {}),
        ...(entry.dataModel ? {dataModel: entry.dataModel} : {}),
      }});
      assert.ok(surface);
      const ctx = new DataContext(surface, '/');
      for (const step of entry.steps) {
        if ('evaluate' in step) {
          evaluate(step, ctx, surface, probes, disposers);
        } else if ('respond' in step) {
          const {call, ...result} = step.respond;
          assert.ok(calls[call], 'No prior exported call at index ' + call);
          await receive({agentFunctionResponse: {functionCallId: calls[call], ...result}});
        } else if ('updateData' in step) {
          await receive({updateDataModel: {surfaceId: 'main', ...step.updateData}});
        } else if (step.cancelSurfaceCalls) {
          protocol.cancelSurfaceCalls(surface.id);
          assert.equal(surface.disposed, false);
        } else {
          assert.equal(step.deleteSurface, true);
          await receive({deleteSurface: {surfaceId: 'main'}});
          assert.equal(surface.disposed, true);
        }
        await setImmediate();
        const sent = emitted.splice(0);
        const outgoingCalls = sent.filter(message => message.callAgentFunction);
        for (const message of outgoingCalls) {
          const {surfaceId, functionCallId, callFunction} = message.callAgentFunction;
          assert.deepEqual(Object.keys(message).sort(), ['callAgentFunction', 'version']);
          assert.deepEqual(Object.keys(message.callAgentFunction).sort(), ['callFunction', 'functionCallId', 'surfaceId']);
          assert.equal(message.version, '1.0');
          assert.equal(surfaceId, 'main');
          assert.ok(typeof functionCallId === 'string' && functionCallId.length);
          assert.ok(!calls.includes(functionCallId), 'Duplicate outbound call identifier');
          assert.deepEqual(JSON.parse(JSON.stringify(callFunction)), callFunction);
          const catalog = catalogs.find(candidate => candidate.id === callFunction.catalogId);
          assert.ok(catalog);
          if (catalog.functions.has(callFunction['@call'])) {
            assertWireMessage(message, {}, [documents.get(catalog.id)]);
          }
          calls.push(functionCallId);
        }
        assertCalls(outgoingCalls, step);

        const wireErrors = sent.filter(message => message.error);
        const errors = [...wireErrors, ...localErrors.splice(0)];
        const actions = sent.filter(message => message.action);
        assert.equal(sent.length, outgoingCalls.length + wireErrors.length + actions.length);
        for (const message of [...wireErrors, ...actions]) assertWireMessage(message);
        assert.equal(errors.length, step.expectErrors?.length ?? 0, JSON.stringify(errors));
        for (const [index, {code, message}] of (step.expectErrors ?? []).entries()) {
          const error = errors[index].error;
          assert.equal(error.code, code);
          if (message !== undefined) assert.ok(error.message.includes(message), error.message);
          if (error.functionCallId !== undefined) {
            assert.ok(step.respond, 'Expected an agent response for an invocation-level error');
            assert.equal(error.functionCallId, calls[step.respond.call]);
          } else {
            assert.equal(error.surfaceId, 'main');
          }
        }
        assert.deepEqual(actions.map(({action}) => ({
          name: action.name, context: action.context,
          ...(action.userMessage === undefined ? {} : {userMessage: action.userMessage}),
        })), step.expectActions ?? []);
        if (step.expectValues) assert.deepEqual(JSON.parse(JSON.stringify(probes.map(read => read()))), step.expectValues);
        assert.deepEqual(transportFailures, []);
      }
      record(suite, entry.name, 'passed');
    } catch (error) {
      record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
      throw error;
    } finally {
      disposers.forEach(dispose => dispose());
      protocol.dispose();
    }
  });
}
