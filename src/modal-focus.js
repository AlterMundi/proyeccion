const focusable = [
  'a[href]', 'button:not(:disabled)', 'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)', 'textarea:not(:disabled)', '[tabindex]', '[contenteditable="true"]',
].join(',');

function tabStops(dialog) {
  return [...dialog.querySelectorAll(focusable)].filter(element => element.tabIndex >= 0
    && element.getClientRects().length && !element.closest('[inert], [aria-hidden="true"]'));
}

/** Keep keyboard handling on the mounted surface and retain the existing modal controls. */
export function bindModalFocus(panel) {
  const document = panel.ownerDocument;
  const restore = new WeakMap();
  let active;

  function update() {
    const next = [...panel.querySelectorAll('.a2ui-modal-overlay > [role="dialog"]')].at(-1);
    if (next === active) return;

    const anchor = active && restore.get(active);
    active = next;
    if (next && !restore.has(next)) {
      restore.set(next, panel.contains(document.activeElement) ? document.activeElement : undefined);
      const first = tabStops(next)[0];
      if (!first) next.tabIndex = -1;
      (first ?? next).focus({preventScroll: true});
    } else if (anchor?.isConnected && (!next || next.contains(anchor))
      && (document.activeElement === document.body || panel.contains(document.activeElement))) {
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
      const stops = tabStops(active);
      const endpoint = event.shiftKey ? stops[0] : stops.at(-1);
      if (stops.length && document.activeElement !== endpoint
        && document.activeElement !== active) return;
      event.preventDefault();
      event.stopPropagation();
      const target = event.shiftKey ? stops.at(-1) : stops[0];
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
