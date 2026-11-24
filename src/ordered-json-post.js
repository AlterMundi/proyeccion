const maxPending = 64;
const responseTimeoutMs = 30000;

/** Send one JSON exchange at a time, preserving the state at enqueue time. */
export function createOrderedJsonPost(url, {credentials = 'same-origin'} = {}) {
  const lifetime = new AbortController();
  let tail = Promise.resolve();
  let pending = 0;

  return {
    signal: lifetime.signal,
    async request(payload, receive) {
      lifetime.signal.throwIfAborted();
      if (pending >= maxPending) throw new Error('Too many pending HTTP requests');
      const body = JSON.stringify(payload);
      pending++;
      const exchange = tail.then(async () => {
        lifetime.signal.throwIfAborted();
        const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(responseTimeoutMs)]);
        const response = await fetch(url, {
          method: 'POST', headers: {'Content-Type': 'application/json'}, body, credentials, signal,
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error('The endpoint returned HTTP ' + response.status);
        }
        return receive(response);
      });
      tail = exchange.catch(() => {});
      try {
        return await exchange;
      } finally {
        pending--;
      }
    },
    dispose() { lifetime.abort(); },
  };
}
