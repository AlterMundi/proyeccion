const focusable = [
  'a[href]', 'button:not(:disabled)', 'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)', 'textarea:not(:disabled)', '[tabindex]', '[contenteditable="true"]',
].join(',');

function tabStops(dialog, backwards = false) {
  const order = element => element.tabIndex || Number.MAX_SAFE_INTEGER;
  const stops = [...dialog.querySelectorAll(focusable)]
    .filter(element => element.tabIndex >= 0 && element.getClientRects().length
      && !element.closest('[inert], [aria-hidden="true"]'))
    .sort((first, second) => order(first) - order(second));

  // A native named radio group contributes one Tab stop. Arrow keys still
  // change the selection inside the group.
  const groups = new Map();
  const isGroupedRadio = element => element.type === 'radio' && element.name;
  for (const element of backwards ? stops.toReversed() : stops) {
    if (!isGroupedRadio(element)) continue;
    if (!groups.has(element.form)) groups.set(element.form, new Map());
    const group = groups.get(element.form);
    if (!group.has(element.name) || element.checked) group.set(element.name, element);
  }
  return stops.filter(element => !isGroupedRadio(element)
    || groups.get(element.form).get(element.name) === element);
}

/** Keep keyboard handling on the mounted surface and retain the existing modal controls. */
export function bindModalFocus(panel) {
  const document = panel.ownerDocument;
  const focused = () => panel.getRootNode().activeElement;
  const restore = new WeakMap();
  let active;

  function update() {
    const next = [...panel.querySelectorAll('.a2ui-modal-overlay > [role="dialog"]')].at(-1);
    if (next === active) return;

    const anchor = active && restore.get(active);
    const current = focused();
    active = next;
    if (next && !restore.has(next)) {
      restore.set(next, panel.contains(current) ? current : undefined);
      const first = tabStops(next)[0];
      if (!first) next.tabIndex = -1;
      (first ?? next).focus({preventScroll: true});
    } else if (anchor?.isConnected && (!next || next.contains(anchor))
      && (document.activeElement === document.body || panel.contains(current))) {
      anchor.focus({preventScroll: true});
    }
  }

  const observer = new document.defaultView.MutationObserver(update);
  observer.observe(panel, {childList: true, subtree: true});

  function onKey(event) {
    if (!active || !active.contains(event.target)) return;
    if (event.key === 'Escape') {
      const close = active.querySelector('.a2ui-modal-close');
      if (!close) return;
      event.preventDefault();
      event.stopPropagation();
      close.click();
    } else if (event.key === 'Tab') {
      const stops = tabStops(active, event.shiftKey);
      event.preventDefault();
      event.stopPropagation();
      const current = stops.indexOf(focused());
      const direction = event.shiftKey ? -1 : 1;
      const target = current < 0 ? stops.at(event.shiftKey ? -1 : 0)
        : stops[(current + direction + stops.length) % stops.length];
      (target ?? active).focus({preventScroll: true});
    }
  }

  panel.addEventListener('keydown', onKey);
  return () => {
    observer.disconnect();
    panel.removeEventListener('keydown', onKey);
    active = undefined;
  };
}
