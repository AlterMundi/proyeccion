import {A2uiRpcError, EventEmitter, MessageProcessor} from '@a2ui/web_core';
import {assertRendererCatalog} from './catalog.js';
import {basicCatalog} from '@a2ui/web_core/catalogs/basic/v1';

export {basicCatalog};

const operations = new Set([
  'createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface',
  'callRendererFunction', 'agentFunctionResponse',
]);
const maxRecordLength = 1024 * 1024;
const maxPendingCalls = 256;

/** Connect one trusted agent transport to an isolated renderer session. */
export function createProtocol({
  send, onTransportError = () => {}, catalogs = [basicCatalog],
  onSurfaceCreated = () => {}, onSurfaceDeleted = () => {}, agentFunctionTimeoutMs = 30000,
}) {
  if (typeof send !== 'function') throw new TypeError('An agent send callback is required');
  for (const catalog of catalogs) assertRendererCatalog(catalog);

  if (!Number.isInteger(agentFunctionTimeoutMs) || agentFunctionTimeoutMs < 1 || agentFunctionTimeoutMs > 2147483647) {
    throw new RangeError('agentFunctionTimeoutMs must be a positive timer duration in milliseconds');
  }

  const returnSurfaces = new Map();
  const pendingModelErrors = new Set();
  let disposed = false;
  let pendingLine = '';
  let discarding = false;

  function outboundListener(envelope) {
    if (disposed) return;
    const callId = envelope.rendererFunctionResponse?.functionCallId;
    const surfaceId = envelope.action?.surfaceId ?? envelope.callAgentFunction?.surfaceId
      ?? envelope.error?.surfaceId;
    const returnedSurface = returnSurfaces.get(callId);
    const matchingSurface = returnedSurface && processor.getSurface(returnedSurface.id) === returnedSurface;
    const surface = surfaceId !== undefined ? processor.getSurface(surfaceId)
      : matchingSurface ? returnedSurface : undefined;
    const onFailure = error => {
      onTransportError(error);
      if (envelope.callAgentFunction) {
        throw new A2uiRpcError('Could not deliver the agent function call.',
          'TRANSPORT_ERROR', envelope.callAgentFunction.functionCallId);
      }
    };
    try {
      const delivery = surface?.sendDataModel
        ? {a2uiRendererDataModel: {version: '1.0', surfaces: {
            [surface.id]: JSON.parse(JSON.stringify(surface.dataModel.get('/'))),
          }}}
        : {};
      const delivered = Promise.resolve(send(envelope, delivery)).catch(onFailure);
      if (envelope.callAgentFunction) return delivered;
    } catch (error) {
      return onFailure(error);
    }
  }

  const processor = new MessageProcessor(catalogs, undefined, {
    version: '1.0',
    defaultTimeoutMs: agentFunctionTimeoutMs,
    reportErrorsOnly: true,
    unifiedOutbound: true,
    validationConfig: {
      targetVersion: '1.0',
      allowDanglingReferences: true,
      allowOrphanComponents: true,
      allowMissingRoot: true,
      allowUnknownElements: true,
    },
    outboundListener,
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
    processor.onSurfaceCreated(onSurfaceCreated),
    processor.onSurfaceDeleted(onSurfaceDeleted),
    processor.model.onError.subscribe(error => {
      pendingModelErrors.add(error);
      queueMicrotask(() => {
        if (!pendingModelErrors.delete(error)) return;
        const {code, message, surfaceId, functionCallId} = error;
        outboundListener({version: '1.0', error: {
          code, message, ...(functionCallId === undefined ? {surfaceId} : {functionCallId}),
        }});
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
    if (typeof id !== 'string' || !id) {
      processor.processMessagesWithErrors(envelope);
      return;
    }
    if (returnSurfaces.has(id) || returnSurfaces.size >= maxPendingCalls) {
      return onTransportError(new Error('Cannot accept this function invocation'));
    }
    returnSurfaces.set(id, processor.getSurface(call.surfaceId));
    // Dispatch each ingress record independently. A pending function must not
    // block following surface mutations or another invocation.
    return processor.processMessagesAsync(envelope).finally(() => returnSurfaces.delete(id));
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

  return {
    receive,
    receiveJsonl,
    finishJsonl() {
      const line = pendingLine;
      pendingLine = '';
      discarding = false;
      if (!disposed) return decodeLine(line);
    },
    capabilities: () => processor.getRendererCapabilities({versions: ['1.0']}),
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
