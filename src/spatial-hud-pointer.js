/** Route an explicitly selected canvas pointer to a spatial HUD. */
export function bindSpatialHudPointer({
  element, hud, rayForPointer, acceptsPointer = event => event.button === 0, tapTolerance = 8,
}) {
  const events = new AbortController();
  const options = {capture: true, signal: events.signal};
  const captures = new Map();
  const released = new Map();

  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function down(event) {
    if (captures.has(event.pointerId)) return;
    released.delete(event.pointerId);
    if (event.defaultPrevented || !acceptsPointer(event)) return;
    const projection = rayForPointer(event);
    if (!projection) return;
    const {ray, maxDistance} = projection;
    const limit = {maxDistance};
    const target = hud.pointerTarget(ray, limit);
    if (target === undefined) return;
    const locomotion = hud.beginLocomotionPointer(ray, event.pointerId, limit);
    consume(event);
    const type = locomotion ? 'locomotion'
      : hud.beginRangeDrag(ray, {...limit, pointerId: event.pointerId}) ? 'range' : 'tap';
    // A second contact on the dragged control must not become a tap when
    // the owning contact releases first.
    const cancelled = type === 'tap' && Array.from(captures.values()).some(intent =>
      intent.type === 'range' && !intent.cancelled && intent.target === target);
    captures.set(event.pointerId, {type, target, cancelled, x: event.clientX, y: event.clientY});
    element.setPointerCapture(event.pointerId);
  }

  function outsideTap(event, intent) {
    return Math.hypot(event.clientX - intent.x, event.clientY - intent.y) > tapTolerance;
  }

  function move(event) {
    const intent = captures.get(event.pointerId);
    if (!intent) return;
    consume(event);
    if (intent.cancelled) return;
    if (intent.type === 'tap') {
      if (outsideTap(event, intent)) intent.cancelled = true;
      return;
    }
    const projection = rayForPointer(event);
    if (!projection) return;
    if (intent.type === 'locomotion') hud.moveLocomotionPointer(event.pointerId, projection.ray);
    else hud.moveRangeDrag(projection.ray, {pointerId: event.pointerId});
  }

  function release(event) {
    const intent = captures.get(event.pointerId);
    if (!intent) return;
    consume(event);
    captures.delete(event.pointerId);
    released.set(event.pointerId, event.timeStamp);
    if (released.size > 16) released.delete(released.keys().next().value);
    return intent;
  }

  function up(event) {
    const intent = release(event);
    if (!intent || intent.cancelled) return;
    if (intent.type === 'locomotion') {
      hud.endLocomotionPointer(event.pointerId);
      return;
    }
    const projection = rayForPointer(event);
    if (intent.type === 'range') {
      if (projection) hud.endRangeDrag(projection.ray, {pointerId: event.pointerId});
      else hud.cancelRangeDrag({pointerId: event.pointerId});
    } else if (!outsideTap(event, intent) && projection) {
      const {ray, maxDistance} = projection;
      if (hud.pointerTarget(ray, {maxDistance}) === intent.target) hud.activateRay(ray, {maxDistance});
    }
  }

  function cancelIntent(id, intent) {
    if (!intent || intent.cancelled) return;
    intent.cancelled = true;
    if (intent.type === 'locomotion') hud.endLocomotionPointer(id);
    if (intent.type === 'range') hud.cancelRangeDrag({pointerId: id});
  }

  function cancel(event) {
    cancelIntent(event.pointerId, release(event));
  }

  function click(event) {
    if (event.detail === 0) return;
    const id = event.pointerId ?? [...released.keys()].at(-1);
    const time = released.get(id);
    if (time === undefined) return;
    released.delete(id);
    if (event.timeStamp - time <= 500) consume(event);
  }

  element.addEventListener('pointerdown', down, options);
  element.addEventListener('pointermove', move, options);
  element.addEventListener('pointerup', up, options);
  element.addEventListener('pointercancel', cancel, options);
  element.addEventListener('lostpointercapture', cancel, options);
  element.addEventListener('click', click, options);

  function unbind() {
    events.abort();
    unbind.cancelGestures();
    for (const id of captures.keys()) {
      if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
    }
    captures.clear();
    released.clear();
  }

  // Suppress the eventual pointerup and click even after the host recovers.
  unbind.cancelGestures = () => {
    for (const [id, intent] of captures) cancelIntent(id, intent);
  };
  return unbind;
}
