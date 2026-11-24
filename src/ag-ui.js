const surfaceOperations = new Set(['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface']);

function fingerprint(operation) {
  return JSON.stringify(operation, (_, value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, value[key]]));
  });
}

/** Render one AG-UI activity with a host-owned Three.js placement. */
export function createAgUiActivityBinding({messageId, mount, onTransportError = () => {}}) {
  if (typeof messageId !== 'string' || !messageId || typeof mount !== 'function') {
    throw new TypeError('An activity message ID and a renderer mount callback are required');
  }
  let renderer;
  let previous;
  let disposed = false;

  return {
    receiveEvent(event) {
      if (disposed || event?.type !== 'ACTIVITY_SNAPSHOT' || event.activityType !== 'a2ui-surface'
          || event.messageId !== messageId) return false;
      if (previous && event.replace === false) return true;
      const operations = event.content?.a2ui_operations ?? [];
      if (!Array.isArray(operations) || operations.some(operation => {
        if (!operation || typeof operation !== 'object' || operation.version !== '1.0') return true;
        const keys = Object.keys(operation).filter(key => key !== 'version');
        return keys.length !== 1 || !surfaceOperations.has(keys[0]);
      })) {
        onTransportError(new TypeError('An AG-UI A2UI snapshot must carry A2UI 1.0 surface operations'));
        return true;
      }
      const next = operations.map(fingerprint);
      let offset = 0;
      if (previous && previous.every((value, index) => value === next[index])) {
        offset = previous.length;
      } else {
        renderer?.dispose();
        renderer = undefined;
      }
      if (operations.length && !renderer) renderer = mount();
      for (const operation of operations.slice(offset)) renderer.receive(operation);
      previous = next;
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      previous = undefined;
      renderer?.dispose();
      renderer = undefined;
    },
  };
}

/** Attach an A2UI 1.0 UI action to the host's AG-UI run input. */
export function withAgUiAction(input, envelope) {
  if (envelope?.version !== '1.0' || !envelope.action || Object.keys(envelope).length !== 2) {
    throw new TypeError('AG-UI action forwarding requires an A2UI 1.0 Action envelope');
  }
  return {
    ...input,
    forwardedProps: {...input.forwardedProps, a2uiAction: {userAction: envelope.action}},
  };
}
