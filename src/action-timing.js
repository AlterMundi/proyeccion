const interactionTimes = new WeakMap();

export function trackActionTimes(dataContext) {
  const resolveAction = dataContext.resolveAction.bind(dataContext);
  dataContext.resolveAction = (action, options) => {
    if (!action.event) return resolveAction(action, options);
    const timestamp = new Date().toISOString();
    const remember = resolved => {
      if (!resolved?.event) return resolved;
      // Web Core forwards the fully resolved context by reference. Give each
      // interaction its own context, including events with no explicit data.
      const context = {...resolved.event.context};
      interactionTimes.set(context, timestamp);
      return {...resolved, event: {...resolved.event, context}};
    };
    const result = resolveAction(action, options);
    return typeof result?.then === 'function' ? result.then(remember) : remember(result);
  };
}

export function applyInteractionTime(envelope) {
  const context = envelope.action?.context;
  const timestamp = interactionTimes.get(context);
  if (timestamp === undefined) return envelope;
  interactionTimes.delete(context);
  return {...envelope, action: {...envelope.action, timestamp}};
}
