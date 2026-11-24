import {createOrderedJsonPost} from './ordered-json-post.js';

/** An ordered SSE reader and JSON-RPC writer for a host-owned A2UI 1.0 session. */
export function createSseJsonRpcBinding(renderer, {
  streamUrl, rpcUrl, withCredentials = false, onTransportError = () => {},
}) {
  const post = createOrderedJsonPost(rpcUrl, {credentials: withCredentials ? 'include' : 'same-origin'});
  let source;
  let nextId = 0;

  async function receiveReceipt(id, reply) {
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

  function request(method, params) {
    const id = ++nextId;
    return post.request({jsonrpc: '2.0', id, method, params}, reply => receiveReceipt(id, reply));
  }

  return {
    connect() {
      post.signal.throwIfAborted();
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
        if (!post.signal.aborted && source.readyState === EventSource.CLOSED) {
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
      post.dispose();
      source?.close();
    },
  };
}
