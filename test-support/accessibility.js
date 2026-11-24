import assert from 'node:assert/strict';

export async function assertComponent(page, id, expected) {
  // Read schema attributes from the actual mounted widget and retain its
  // selector for separate assertions against Chromium's accessible controls.
  const element = await page.evaluate(id => {
    const host = [...document.querySelectorAll('a2ui-surface *')]
      .find(node => node.context?.componentModel.id === id);
    if (!host) return null;
    host.dataset.fixtureComponent = id;
    const control = host.querySelector('button, input, textarea, [role="radiogroup"]');
    const own = name => {
      if (host.hasAttribute(name)) return host.getAttribute(name);
      return [...host.querySelectorAll('[' + name + ']')]
        .find(node => {
          for (let current = node; current !== host; current = current.parentElement) {
            if (current.context || current.node) return false;
          }
          return !node.matches('.a2ui-filter-input, .a2ui-modal-close');
        })?.getAttribute(name);
    };
    return {
      button: control?.tagName === 'BUTTON',
      label: own('aria-label') ?? control?.textContent?.trim() ?? host.textContent?.trim(),
      description: own('aria-description'),
      live: host.getAttribute('aria-live'),
      hidden: host.getAttribute('aria-hidden'),
      checked: control?.checked,
    };
  }, id);
  assert.ok(element, 'Expected mounted component ' + id);
  for (const key of ['label', 'description', 'live', 'checked']) {
    if (expected[key] !== undefined) assert.equal(element[key], expected[key], id + '.' + key);
  }
  if (expected.hidden !== undefined) assert.equal(element.hidden, String(expected.hidden), id + '.hidden');
  const role = expected.role ?? (element.button ? 'button' : undefined);
  if (role) {
    const control = page.locator('[data-fixture-component="' + id + '"]')
      .getByRole(role, expected.label ? {name: expected.label, exact: true} : {});
    assert.equal(await control.count(), expected.hidden ? 0 : 1, id + ' browser role/name');
  }
}
