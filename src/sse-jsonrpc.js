const maxPendingRequests = 64;
const receiptTimeoutMs = 30000;

/** An ordered SSE reader and JSON-RPC writer for a host-owned A2UI 1.0 session. */
export function createSseJsonRpcBinding(renderer, {
  streamUrl, rpcUrl, withCredentials = false, onTransportError = () => {},
}) {
  const lifetime = new AbortController();
  let source;
  let lastRequest = Promise.resolve();
  let nextId = 0;
  let pending = 0;

  async function post(id, body) {
    lifetime.signal.throwIfAborted();
    const reply = await fetch(rpcUrl, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body,
      credentials: withCredentials ? 'include' : 'same-origin',
      signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(receiptTimeoutMs)]),
    });
    if (!reply.ok) {
      await reply.body?.cancel();
      throw new Error('The JSON-RPC endpoint returned HTTP ' + reply.status);
    }
    const receipt = await reply.json();
    if (receipt?.jsonrpc !== '2.0' || receipt.id !== id
        || Object.hasOwn(receipt, 'result') === Object.hasOwn(receipt, 'error')) {
      throw new TypeError('Invalid JSON-RPC receipt');
    }
    if (Object.hasOwn(receipt, 'error')) {
      throw new Error(receipt.error?.message ?? 'The JSON-RPC endpoint rejected the request');
    }
    return receipt.result;
  }

  async function request(method, params) {
    lifetime.signal.throwIfAborted();
    if (pending >= maxPendingRequests) throw new Error('Too many pending JSON-RPC requests');
    const id = ++nextId;
    const body = JSON.stringify({jsonrpc: '2.0', id, method, params});
    pending++;
    const result = lastRequest.then(() => post(id, body));
    lastRequest = result.catch(() => {});
    try {
      return await result;
    } finally {
      pending--;
    }
  }

  return {
    connect() {
      lifetime.signal.throwIfAborted();
      if (source) return;
      source = new EventSource(streamUrl, {withCredentials});
      source.addEventListener('a2ui', event => {
        let envelope;
        try {
          envelope = JSON.parse(event.data);
        } catch (error) {
          onTransportError(error);
          return;
        }
        renderer.receive(envelope);
      });
      source.addEventListener('error', () => {
        if (!lifetime.signal.aborted && source.readyState === EventSource.CLOSED) {
          onTransportError(new Error('The A2UI event stream closed'));
        }
      });
    },
    advertise(options) {
      return request('a2ui.capabilities', {metadata: {a2uiRendererCapabilities: renderer.capabilities(options)}});
    },
    send(envelope, metadata = {}) {
      return request('a2ui.send', {envelope, metadata});
    },
    dispose() {
      lifetime.abort();
      source?.close();
    },
  };
}
