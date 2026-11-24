import {createOrderedJsonPost} from './ordered-json-post.js';

/** One A2UI 1.0 request-response session hosted on a JSON POST endpoint. */
export function createHttpTurnBinding(renderer, {url, credentials, agentCapabilities, inlineCatalogIds = []}) {
  const post = createOrderedJsonPost(url, {credentials});
  const selected = [...inlineCatalogIds];

  async function receive(response) {
    if (response.status === 204) return;
    const result = await response.json();
    post.signal.throwIfAborted();
    if (!Array.isArray(result?.messages)) throw new TypeError('Expected a response with an A2UI messages array');
    // A function reply can issue another POST. Dispatch without holding the current exchange open.
    for (const envelope of result.messages) renderer.receive(envelope);
  }

  function exchange(messages, metadata = {}) {
    const a2uiRendererCapabilities = renderer.capabilities({agentCapabilities, inlineCatalogIds: selected});
    return post.request({messages, metadata: {...metadata, a2uiRendererCapabilities}}, receive);
  }

  return {
    poll() { return exchange([]); },
    send(envelope, metadata) { return exchange([envelope], metadata); },
    dispose: post.dispose,
  };
}
