import {A2uiCatalogError, A2uiRpcError, A2uiValidationError, EventEmitter} from '@a2ui/web_core';
import {assertRendererCatalog, componentActionAliases} from './catalog.js';
import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';
import {RendererMessageProcessor} from './ingress-validation.js';
import {applyInteractionTime} from './action-timing.js';

export {basicCatalog};

const operations = new Set([
  'createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface',
  'callRendererFunction', 'agentFunctionResponse',
]);
const maxRecordLength = 1024 * 1024;
const maxPendingCalls = 256;

function rpcFailure(functionCallId, code, message) {
  return {version: '1.0', rendererFunctionResponse: {functionCallId, error: {code, message}}};
}

function wireOutcome(envelope) {
  const response = envelope.rendererFunctionResponse;
  if (!response || !Object.hasOwn(response, 'value')) return envelope;
  try {
    const encoded = JSON.stringify(response.value, (_, value) => {
      const type = typeof value;
      if (type === 'undefined' || type === 'function' || type === 'symbol' ||
          (type === 'number' && !Number.isFinite(value))) {
        throw new TypeError('Expected a JSON value.');
      }
      return value;
    });
    return {...envelope, rendererFunctionResponse: {...response, value: JSON.parse(encoded)}};
  } catch {
    return rpcFailure(response.functionCallId, 'EXECUTION_ERROR', 'The renderer function did not return a JSON value.');
  }
}

function requireSyncableRoot(surface) {
  if (!surface.sendDataModel) return;
  const set = surface.dataModel.set.bind(surface.dataModel);
  surface.dataModel.set = (path, value, preserveNull) => {
    // Web Core resolves an empty path or a path of only slash separators as root.
    if (typeof path === 'string' && /^\/*$/.test(path) && value != null) {
      const prototype = typeof value === 'object' ? Object.getPrototypeOf(value) : undefined;
      if (prototype !== Object.prototype && prototype !== null) {
        throw new A2uiValidationError('A synchronized surface requires a JSON object at the root.',
          undefined, undefined, {path: '/value', surfaceId: surface.id});
      }
    }
    return set(path, value, preserveNull);
  };
}

/** Connect one trusted agent transport to an isolated renderer session. */
export function createProtocol({
  send, onTransportError = () => {}, catalogs = [basicCatalog],
  onSurfaceCreated = () => {}, onSurfaceDeleted = () => {}, agentFunctionTimeoutMs = 30000,
  maxAgentCallCacheEntries,
}) {
  if (send !== undefined && typeof send !== 'function') throw new TypeError('The agent send callback must be a function');
  const registeredCatalogs = new Map();
  function checkCatalog(catalog) {
    assertRendererCatalog(catalog);
    if (registeredCatalogs.has(catalog.id)) throw new A2uiCatalogError(`Catalog already registered: ${catalog.id}`);
  }
  for (const catalog of catalogs) {
    checkCatalog(catalog);
    registeredCatalogs.set(catalog.id, catalog);
  }

  if (!Number.isInteger(agentFunctionTimeoutMs) || agentFunctionTimeoutMs < 1 || agentFunctionTimeoutMs > 2147483647) {
    throw new RangeError('agentFunctionTimeoutMs must be a positive timer duration in milliseconds');
  }
  if (maxAgentCallCacheEntries !== undefined && (!Number.isSafeInteger(maxAgentCallCacheEntries)
      || maxAgentCallCacheEntries < 0)) {
    throw new RangeError('maxAgentCallCacheEntries must be a non-negative integer');
  }

  const returnSurfaces = new Map();
  const pendingModelErrors = new Set();
  const errorSurfaces = new WeakMap();
  let disposed = false;
  let pendingLine = '';
  let discarding = false;

  function outboundListener(envelope, originatingSurface) {
    if (disposed || !send) return;
    const callId = envelope.rendererFunctionResponse?.functionCallId;
    const surfaceId = envelope.action?.surfaceId ?? envelope.callAgentFunction?.surfaceId
      ?? envelope.error?.surfaceId;
    const surface = originatingSurface ?? returnSurfaces.get(callId)
      ?? (surfaceId === undefined ? undefined : processor.getSurface(surfaceId));
    const onFailure = error => {
      onTransportError(error);
      if (envelope.callAgentFunction) {
        throw new A2uiRpcError('Could not deliver the agent function call.',
          'TRANSPORT_ERROR', envelope.callAgentFunction.functionCallId);
      }
    };
    try {
      const delivery = surface?.sendDataModel && processor.getSurface(surface.id) === surface
        ? {a2uiRendererDataModel: {version: '1.0', surfaces: {
            [surface.id]: JSON.parse(JSON.stringify(surface.dataModel.get('/'))),
          }}}
        : {};
      let deliverable = applyInteractionTime(wireOutcome(envelope));
      const action = deliverable.action;
      if (action && surface) {
        const source = surface.componentsModel.get(action.sourceComponentId);
        const component = source?.catalog?.components.get(source.type);
        const name = componentActionAliases.get(component)?.get(action.name);
        if (name) deliverable = {...deliverable, action: {...action, name}};
      }
      const delivered = Promise.resolve(send(deliverable, delivery)).catch(onFailure);
      if (envelope.callAgentFunction) return delivered;
    } catch (error) {
      return onFailure(error);
    }
  }

  const processor = new RendererMessageProcessor(catalogs, undefined, {
    version: '1.0',
    defaultTimeoutMs: agentFunctionTimeoutMs,
    maxAgentCallCacheEntries: maxAgentCallCacheEntries || undefined,
    reportErrorsOnly: true,
    unifiedOutbound: Boolean(send),
    validationConfig: {
      targetVersion: '1.0',
      allowDanglingReferences: true,
      allowOrphanComponents: true,
      allowMissingRoot: true,
      allowUnknownElements: true,
    },
    outboundListener: send ? outboundListener : undefined,
    errorHandler({error}) {
      // Web Core publishes ingress failures both on the model and on the wire.
      // Preserve the canonical envelope, including its path, once.
      for (const pending of pendingModelErrors) {
        if (pending.code === error.code && pending.message === error.message &&
            pending.surfaceId === error.surfaceId) {
          pendingModelErrors.delete(pending);
          break;
        }
      }
    },
  });
  // Web Core 0.16.1 reads argument diagnostics through surface.onError
  // before replying. Give that evaluator its own channel so asynchronous
  // expression failures stay with their invocation. Execution of the outer
  // function and normal surface bindings still use the original context.
  const resolveArguments = processor.rpc.resolveDynamicArguments.bind(processor.rpc);
  processor.rpc.resolveDynamicArguments = (args, context, isUserActivated) => {
    const {surface} = context;
    if (!surface) return resolveArguments(args, context, isUserActivated);
    const diagnostics = new EventEmitter();
    const argumentSurface = Object.create(surface, {
      onError: {value: diagnostics},
      dispatchError: {value: error => error.code === 'EXPRESSION_ERROR'
        ? diagnostics.emit(error) : surface.dispatchError(error)},
    });
    const argumentContext = Object.create(context, {surface: {value: argumentSurface}});
    return resolveArguments(args, argumentContext, isUserActivated);
  };

  const subscriptions = [
    processor.onSurfaceCreated(surface => {
      requireSyncableRoot(surface);
      if (maxAgentCallCacheEntries === 0) {
        const callAgentFunction = surface.callAgentFunction.bind(surface);
        surface.callAgentFunction = (call, options) => callAgentFunction(call, {...options, bypassCache: true});
      }
      // The model forwards the same error event and queues its delivery. Keep
      // the originating surface for call-correlated errors without adding a
      // surfaceId to the wire error or retaining a call history.
      surface.onError.subscribe(error => { errorSurfaces.set(error, surface); });
      onSurfaceCreated(surface);
    }),
    processor.onSurfaceDeleted(onSurfaceDeleted),
    processor.model.onError.subscribe(error => {
      pendingModelErrors.add(error);
      queueMicrotask(() => {
        if (!pendingModelErrors.delete(error)) return;
        const {code, message, surfaceId, functionCallId} = error;
        outboundListener({version: '1.0', error: {
          code, message, ...(functionCallId === undefined ? {surfaceId} : {functionCallId}),
        }}, errorSurfaces.get(error));
      });
    }),
  ];

  function receive(envelope) {
    if (disposed) return;
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      return onTransportError(new TypeError('Expected one A2UI 1.0 message object'));
    }
    if (!Object.hasOwn(envelope, 'version')) {
      return onTransportError(new TypeError('Missing required version field'));
    }
    if (envelope.version !== '1.0') {
      return onTransportError(new TypeError(typeof envelope.version === 'string'
        ? `Unsupported protocol version '${envelope.version}'`
        : 'Protocol version must be a string'));
    }
    const names = Object.keys(envelope).filter(key => key !== 'version');
    if (names.length > 1) {
      return onTransportError(new TypeError('Message contains multiple conflicting update actions'));
    }
    if (names.length !== 1) {
      return onTransportError(new TypeError('Message is missing its A2UI action'));
    }
    if (!operations.has(names[0])) {
      return onTransportError(new TypeError(`The action '${names[0]}' is not supported in protocol version 1.0`));
    }

    const call = envelope.callRendererFunction;
    const id = call?.functionCallId;
    if (names[0] === 'callRendererFunction' && !send) {
      return onTransportError(new A2uiRpcError('A renderer function call requires a return channel.', 'NO_LISTENER', id));
    }
    if (typeof id !== 'string' || !id) {
      processor.processMessagesWithErrors(envelope);
      return;
    }
    if (returnSurfaces.has(id)) {
      return onTransportError(new Error('A function invocation with this ID is already pending'));
    }
    const surface = processor.getSurface(call.surfaceId);
    if (returnSurfaces.size >= maxPendingCalls) {
      return outboundListener(rpcFailure(id, 'INVALID_FUNCTION_CALL',
        'The renderer has reached its pending invocation limit.'), surface);
    }
    returnSurfaces.set(id, surface);
    // Dispatch each ingress record independently. A pending function must not
    // block following surface mutations or another invocation.
    return processor.processMessagesAsync(envelope).finally(() => returnSurfaces.delete(id));
  }

  async function receiveBatch(batch) {
    if (disposed) return;
    const container = batch && Object.hasOwn(batch, 'messages') && Object.keys(batch).length === 1;
    const envelopes = container ? batch.messages : batch;
    if (!Array.isArray(envelopes)) {
      return onTransportError(new TypeError('Expected an A2UI envelope array or a messages container'));
    }
    // Start each envelope in order and wait for replies only after dispatch.
    await Promise.all(envelopes.map(receive));
  }

  function decodeLine(line) {
    if (line.length > maxRecordLength) {
      onTransportError(new RangeError('A2UI JSONL record exceeds the session limit'));
      return;
    }
    if (!line.trim()) return;
    let envelope;
    try {
      envelope = JSON.parse(line);
    } catch (error) {
      onTransportError(error);
      return;
    }
    return receive(envelope);
  }

  function receiveJsonl(chunk) {
    if (disposed) return;
    let start = 0;
    for (let end = chunk.indexOf('\n'); end !== -1; end = chunk.indexOf('\n', start)) {
      if (!discarding) decodeLine(pendingLine + chunk.slice(start, end));
      pendingLine = '';
      discarding = false;
      start = end + 1;
    }
    if (discarding) return;
    if (pendingLine.length + chunk.length - start > maxRecordLength) {
      pendingLine = '';
      discarding = true;
      onTransportError(new RangeError('A2UI JSONL record exceeds the session limit'));
      return;
    }
    pendingLine += chunk.slice(start);
  }

  function capabilities({agentCapabilities, inlineCatalogIds = []} = {}) {
    const published = processor.getRendererCapabilities({versions: ['1.0']});
    if (agentCapabilities?.['1.0']?.acceptsInlineCatalogs !== true || inlineCatalogIds.length === 0) return published;
    published['1.0'].inlineCatalogs = [...new Set(inlineCatalogIds)].map(id => {
      const catalog = registeredCatalogs.get(id);
      if (!catalog) throw new A2uiCatalogError(`Cannot advertise an unregistered inline catalog: ${id}`);
      return structuredClone({...catalog.toJson(), catalogId: id, protocolVersion: '1.0'});
    });
    return published;
  }

  return {
    receive,
    receiveBatch,
    hasSurface(id) { return !disposed && Boolean(processor.getSurface(id)); },
    cancelSurfaceCalls(surfaceId) {
      if (!disposed && processor.getSurface(surfaceId)) processor.rpc.cancelSurfaceCalls(surfaceId);
    },
    receiveJsonl,
    finishJsonl() {
      const line = pendingLine;
      pendingLine = '';
      discarding = false;
      if (!disposed) return decodeLine(line);
    },
    capabilities,
    addCatalog(catalog) {
      if (disposed) throw new A2uiCatalogError('Cannot add a catalog to a disposed renderer session');
      checkCatalog(catalog);
      processor.addCatalog(catalog);
      registeredCatalogs.set(catalog.id, catalog);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      pendingLine = '';
      for (const subscription of subscriptions) subscription.unsubscribe();
      processor.dispose();
      returnSurfaces.clear();
    },
  };
}
