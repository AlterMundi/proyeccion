/** Route an explicitly selected canvas pointer to a spatial HUD. */
export function bindSpatialHudPointer({
  element, hud, rayForPointer, acceptsPointer = event => event.isPrimary && event.button === 0, tapTolerance = 8,
}) {
  const events = new AbortController();
  const options = {capture: true, signal: events.signal};
  let capture;
  let released;

  function consume(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function down(event) {
    if (capture) return;
    released = undefined;
    if (event.defaultPrevented || !acceptsPointer(event)) return;
    const projection = rayForPointer(event);
    if (!projection) return;
    const {ray, maxDistance} = projection;
    const limit = {maxDistance};
    const target = hud.pointerTarget(ray, limit);
    if (target === undefined) return;
    consume(event);
    capture = {
      id: event.pointerId, target, x: event.clientX, y: event.clientY,
      dragging: hud.beginRangeDrag(ray, limit),
    };
    element.setPointerCapture(event.pointerId);
  }

  function outsideTap(event, intent) {
    return Math.hypot(event.clientX - intent.x, event.clientY - intent.y) > tapTolerance;
  }

  function move(event) {
    if (capture?.id !== event.pointerId) return;
    consume(event);
    if (capture.dragging) {
      const projection = rayForPointer(event);
      if (projection) hud.moveRangeDrag(projection.ray);
    } else if (outsideTap(event, capture)) {
      capture.cancelled = true;
    }
  }

  function up(event) {
    if (capture?.id !== event.pointerId) return;
    consume(event);
    const intent = capture;
    capture = undefined;
    released = {id: event.pointerId, time: event.timeStamp};
    const projection = rayForPointer(event);
    if (intent.dragging) {
      if (projection) hud.endRangeDrag(projection.ray);
      else hud.cancelRangeDrag();
    } else if (!intent.cancelled && !outsideTap(event, intent) && projection) {
      const {ray, maxDistance} = projection;
      if (hud.pointerTarget(ray, {maxDistance}) === intent.target) hud.activateRay(ray, {maxDistance});
    }
  }

  function cancel(event) {
    if (capture?.id !== event.pointerId) return;
    consume(event);
    released = {id: event.pointerId, time: event.timeStamp};
    if (capture.dragging) hud.cancelRangeDrag();
    capture = undefined;
  }

  function click(event) {
    if (!released || event.detail === 0 || event.timeStamp - released.time > 500
        || (event.pointerId !== undefined && event.pointerId !== released.id)) return;
    released = undefined;
    consume(event);
  }

  element.addEventListener('pointerdown', down, options);
  element.addEventListener('pointermove', move, options);
  element.addEventListener('pointerup', up, options);
  element.addEventListener('pointercancel', cancel, options);
  element.addEventListener('lostpointercapture', cancel, options);
  element.addEventListener('click', click, options);

  return () => {
    events.abort();
    if (capture?.dragging) hud.cancelRangeDrag();
    if (capture && element.hasPointerCapture(capture.id)) element.releasePointerCapture(capture.id);
    capture = released = undefined;
  };
}
