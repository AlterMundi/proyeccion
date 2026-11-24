// Accessible controls share the scene renderer's action path. This clipped
// tree provides semantics and native input while meshes supply the visuals.
export function createHudAccessibility(parent, {focusControl, activate}) {
  const document = parent.ownerDocument;
  const root = document.createElement('div');
  root.dataset.spatialHudAccessibility = '';
  Object.assign(root.style, {
    position: 'fixed', top: '0', left: '0', width: '1px', height: '1px',
    overflow: 'hidden', clipPath: 'inset(50%)', pointerEvents: 'none',
  });
  parent.append(root);
  const groups = new Map();

  function makeElement(row, surfaceId) {
    let element;
    switch (row.type) {
      case 'HudButton':
      case 'HudTextInput':
      case 'HudJump':
        element = document.createElement('button');
        element.type = 'button';
        element.addEventListener('click', () => activate(surfaceId, row));
        break;
      case 'HudRange':
        element = document.createElement('input');
        element.type = 'range';
        element.addEventListener('change', () => activate(surfaceId, row, element.valueAsNumber));
        break;
      case 'HudChoice':
        element = document.createElement('select');
        element.addEventListener('change', () => activate(surfaceId, row, element.value));
        break;
      default:
        element = document.createElement('p');
    }
    if (row.target && row.type !== 'HudStick') element.addEventListener('focus', () => focusControl(surfaceId, row.instanceId));
    return {element};
  }

  function updateElement(record, row) {
    const {element} = record;
    const disabled = typeof row.action !== 'function';
    if (row.target && row.type !== 'HudStick') {
      if (element.disabled !== disabled) element.disabled = disabled;
      if (record.label !== row.semanticLabel) {
        element.setAttribute('aria-label', row.semanticLabel);
        record.label = row.semanticLabel;
      }
    }
    switch (row.type) {
      case 'HudButton':
        if (record.pressed !== row.pressed) {
          if (row.pressed === undefined) element.removeAttribute('aria-pressed');
          else element.setAttribute('aria-pressed', String(row.pressed));
          record.pressed = row.pressed;
        }
        break;
      case 'HudRange':
        if (row.range) {
          const {min, max, step, current} = row.range;
          if (element.min !== String(min)) element.min = min;
          if (element.max !== String(max)) element.max = max;
          if (element.step !== String(step)) element.step = step;
          if (element.valueAsNumber !== current) element.valueAsNumber = current;
        }
        break;
      case 'HudChoice': {
        const options = row.choice?.options;
        if (record.options !== options) {
          const items = (options ?? []).map(({id, label, disabled}) => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = label;
            option.disabled = Boolean(disabled);
            return option;
          });
          element.replaceChildren(...items);
          record.options = options;
        }
        if (element.value !== row.choice?.current || record.currentChoice !== row.choice?.current) {
          element.value = row.choice?.current ?? '';
          record.currentChoice = row.choice?.current;
        }
        break;
      }
      case 'HudTextInput':
        break;
      default:
        if (record.style !== row.style) {
          if (row.style === 'status') element.setAttribute('role', 'status');
          else element.removeAttribute('role');
          record.style = row.style;
        }
        if (element.textContent !== row.semanticLabel) element.textContent = row.semanticLabel;
    }
  }

  function render(surfaces) {
    const activeGroups = new Set();
    let groupCursor = root.firstChild;
    for (const {id, label, rows} of surfaces) {
      activeGroups.add(id);
      let group = groups.get(id);
      if (!group) {
        const element = document.createElement('div');
        element.setAttribute('role', 'group');
        group = {element, records: new Map()};
        groups.set(id, group);
      }
      if (group.label !== label) {
        group.element.setAttribute('aria-label', label);
        group.label = label;
      }
      if (group.element !== groupCursor) root.insertBefore(group.element, groupCursor);
      groupCursor = group.element.nextSibling;
      const activeRows = new Set();
      let cursor = group.element.firstChild;
      for (const row of rows) {
        if (!row.semanticLabel) continue;
        activeRows.add(row);
        let record = group.records.get(row);
        if (!record) group.records.set(row, record = makeElement(row, id));
        if (record.element !== cursor) group.element.insertBefore(record.element, cursor);
        cursor = record.element.nextSibling;
        updateElement(record, row);
      }
      for (const [row, {element}] of group.records) {
        if (activeRows.has(row)) continue;
        element.remove();
        group.records.delete(row);
      }
    }
    for (const [id, {element}] of groups) {
      if (activeGroups.has(id)) continue;
      element.remove();
      groups.delete(id);
    }
  }

  return {
    render,
    owns: target => Boolean(target?.nodeType && root.contains(target)),
    focus(surfaceId, instanceId) {
      const group = groups.get(surfaceId);
      if (!group) return false;
      const element = instanceId === undefined
        ? group.element.querySelector('button:not(:disabled), input:not(:disabled), select:not(:disabled)')
        : [...group.records].find(([row, record]) => row.target && row.type !== 'HudStick' && !record.element.disabled
          && row.instanceId === instanceId)?.[1].element;
      element?.focus({preventScroll: true});
      return Boolean(element && document.activeElement === element);
    },
    dispose() { root.remove(); groups.clear(); },
  };
}
