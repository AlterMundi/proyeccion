/** An HTTP action writer and WebSocket reader for a host-owned A2UI session. */
export function createHttpLiveBinding({
  streamUrl, actionUrl, mount, onActionReceipt = () => {}, onTransportError,
}) {
  let session;
  let projection;
  let disposed = false;

  function disconnect() {
    const previous = session;
    session = undefined;
    previous?.actions.abort();
    previous?.socket.close();
  }

  async function sendAction(owner, envelope) {
    if (session !== owner || owner.socket.readyState !== WebSocket.OPEN) {
      throw new Error('The projection connection is closed');
    }
    if (envelope?.version !== '1.0' || !envelope.action) {
      throw new TypeError('The HTTP action endpoint accepts A2UI 1.0 actions');
    }
    const request = {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(envelope),
      signal: owner.actions.signal,
    };
    let response;
    try {
      response = await fetch(actionUrl, request);
    } catch (cause) {
      // A failed fetch cannot tell the host whether the application committed the action.
      const error = new Error('The HTTP action outcome is unknown', {cause});
      error.code = 'ACTION_OUTCOME_UNKNOWN';
      error.action = envelope.action;
      if (!onTransportError) throw error;
      onTransportError(error);
      return;
    }
    response.body?.cancel().catch(() => {});
    if (session !== owner || owner.actions.signal.aborted) return;
    onActionReceipt({status: response.status, action: envelope.action});
    if (!response.ok && response.status !== 409) {
      throw new Error('The action endpoint returned HTTP ' + response.status);
    }
  }

  function receive(owner, data) {
    if (session !== owner) return;
    let envelopes;
    try {
      if (typeof data !== 'string') throw new TypeError('Expected a text frame with A2UI envelopes');
      envelopes = JSON.parse(data);
      if (!Array.isArray(envelopes)) throw new TypeError('Expected an array of A2UI envelopes');
      if (!owner.view && (envelopes[0]?.version !== '1.0'
          || typeof envelopes[0]?.createSurface?.surfaceId !== 'string')) {
        throw new TypeError('The first A2UI frame must create a surface');
      }
    } catch (error) {
      onTransportError?.(error);
      return;
    }
    if (!owner.view) {
      const [first, ...rest] = envelopes;
      let view;
      try {
        view = mount(envelope => sendAction(owner, envelope));
        view.receive(first);
        if (!view.hasSurface(first.createSurface.surfaceId)) {
          throw new Error('The first A2UI frame did not create its surface');
        }
      } catch (error) {
        view?.dispose();
        onTransportError?.(error);
        return;
      }
      if (session !== owner) {
        view.dispose();
        return;
      }
      const previous = projection;
      projection = owner.view = view;
      previous?.dispose();
      envelopes = rest;
    }
    for (const envelope of envelopes) owner.view.receive(envelope);
  }

  return {
    get projection() { return projection; },
    connect() {
      if (disposed) throw new Error('The projection binding is disposed');
      const socket = new WebSocket(streamUrl);
      disconnect();
      const owner = {socket, actions: new AbortController()};
      session = owner;
      socket.addEventListener('message', event => receive(owner, event.data));
      socket.addEventListener('close', () => {
        if (session === owner) owner.actions.abort();
      });
      socket.addEventListener('error', () => {
        if (session === owner) onTransportError?.(new Error('The projection connection failed'));
      });
    },
    disconnect,
    dispose() {
      if (disposed) return;
      disposed = true;
      disconnect();
      projection?.dispose();
      projection = undefined;
    },
  };
}
