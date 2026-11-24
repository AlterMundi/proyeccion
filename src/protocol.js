import {MessageProcessor} from '@a2ui/web_core';
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
  onSurfaceCreated = () => {}, onSurfaceDeleted = () => {},
}) {
  if (typeof send !== 'function') throw new TypeError('An agent send callback is required');
  if (catalogs.some(catalog => catalog.protocolVersion !== '1.0')) {
    throw new TypeError('Proyeccion accepts only A2UI 1.0 catalogs');
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
    try {
      const delivery = surface?.sendDataModel
        ? {a2uiRendererDataModel: {version: '1.0', surfaces: {
            [surface.id]: JSON.parse(JSON.stringify(surface.dataModel.get('/'))),
          }}}
        : {};
      Promise.resolve(send(envelope, delivery)).catch(onTransportError);
    } catch (error) {
      onTransportError(error);
    }
  }

  const processor = new MessageProcessor(catalogs, undefined, {
    version: '1.0',
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
