const maxFrameBytes = 1024 * 1024;

/** Bind one connected or connecting WebSocket to one A2UI 1.0 renderer session. */
export function createWebSocketBinding(renderer, {socket, inlineCatalogIds = [], onTransportError = () => {}}) {
  const selected = [...inlineCatalogIds];
  let acceptsInlineCatalogs = false;
  let disposed = false;

  function sendFrame(messages, metadata) {
    if (disposed || socket.readyState !== WebSocket.OPEN) throw new Error('The WebSocket session is closed');
    const text = JSON.stringify({messages, metadata});
    if (socket.bufferedAmount + new Blob([text]).size > maxFrameBytes) {
      throw new RangeError('The WebSocket send buffer exceeds the session limit');
    }
    socket.send(text);
  }

  function advertise() {
    const a2uiRendererCapabilities = renderer.capabilities({
      agentCapabilities: {'1.0': {acceptsInlineCatalogs}}, inlineCatalogIds: selected,
    });
    sendFrame([], {a2uiRendererCapabilities});
  }

  function open() {
    try { advertise(); }
    catch (error) { onTransportError(error); }
  }

  function receive(event) {
    let frame;
    try {
      if (typeof event.data !== 'string' || new Blob([event.data]).size > maxFrameBytes) {
        throw new TypeError('Expected a bounded WebSocket text frame');
      }
      frame = JSON.parse(event.data);
      if (!Array.isArray(frame?.messages)) throw new TypeError('Expected a WebSocket frame with an A2UI messages array');
    } catch (error) {
      onTransportError(error);
      return;
    }
    const capabilities = frame.metadata?.a2uiAgentCapabilities;
    if (capabilities && selected.length) {
      const next = capabilities['1.0']?.acceptsInlineCatalogs === true;
      if (next !== acceptsInlineCatalogs) {
        acceptsInlineCatalogs = next;
        open();
      }
    }
    for (const envelope of frame.messages) renderer.receive(envelope);
  }

  const connectionError = () => onTransportError(new Error('The WebSocket connection failed'));
  socket.addEventListener('open', open, {once: true});
  socket.addEventListener('message', receive);
  socket.addEventListener('error', connectionError);
  if (socket.readyState === WebSocket.OPEN) open();

  return {
    advertise,
    send(envelope, metadata = {}) { sendFrame([envelope], metadata); },
    dispose() {
      if (disposed) return;
      disposed = true;
      socket.removeEventListener('open', open);
      socket.removeEventListener('message', receive);
      socket.removeEventListener('error', connectionError);
      socket.close();
    },
  };
}
