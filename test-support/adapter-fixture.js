import assert from 'node:assert/strict';

export async function assertViewTree(page, expected, surfaceId) {
  const actual = await page.evaluate(({expected, surfaceId}) => {
    const component = host => host.context?.componentModel;
    const childComponents = host => [...host.querySelectorAll('*')].filter(child => {
      if (!component(child)) return false;
      for (let current = child.parentElement; current && current !== host; current = current.parentElement) {
        if (component(current)) return false;
      }
      return true;
    });
    function nativeValue(element, value) {
      const input = element.querySelector('input:not([type="hidden"]), textarea');
      if (Array.isArray(value)) {
        return [...element.querySelectorAll('input:checked')].map(option => option.value);
      }
      if (input?.type === 'checkbox') return input.checked;
      if (input?.type === 'range') return input.valueAsNumber;
      const time = element.querySelector('input[type="time"]');
      if (input?.type === 'date' && time) {
        const minutes = time.value;
        const dateTime = input.value + 'T' + (minutes.length === 5 ? minutes + ':00' : minutes);
        return value.endsWith('Z') ? new Date(dateTime).toISOString().replace('.000Z', 'Z') : dateTime;
      }
      return input?.value;
    }
    const read = (element, shape) => {
      const props = {};
      for (const [key, value] of Object.entries(shape ?? {})) {
        switch (key) {
          case 'id': props.id = component(element)?.id; break;
          case 'type': props.type = component(element)?.type; break;
          case 'isValid': {
            props.isValid = !element.querySelector('.a2ui-textfield').classList.contains('a2ui-invalid');
            if (props.isValid !== window.fixture.props(element.node).isValid) {
              throw new Error('Rendered input validity disagrees with its resolved state');
            }
            break;
          }
          case 'validationErrors': props[key] = window.fixture.props(element.node)[key]; break;
          case 'validationResults': {
            props[key] = window.fixture.props(element.node)[key];
            const warnings = [...element.querySelectorAll('.proyeccion-validation-hint[data-severity=warning]')]
              .map(hint => hint.textContent.trim());
            const expectedWarnings = value.filter(result => result.severity === 'warning').map(result => result.message);
            if (JSON.stringify(warnings) !== JSON.stringify(expectedWarnings)) {
              throw new Error('Visible warnings differ from the expected check results');
            }
            break;
          }
          case 'hints': props.hints = [...element.querySelectorAll('.proyeccion-validation-hint[data-severity=info]')]
            .map(hint => hint.textContent.trim()); break;
          case 'label': props.label = element.querySelector('label, legend')?.textContent.trim(); break;
          case 'badgeText':
          case 'text': {
            const heading = /^#+ /.exec(value);
            props[key] = heading
              ? heading[0] + (element.querySelector('h' + heading[0].trim().length)?.textContent.trim() ?? '')
              : element.textContent.trim();
            break;
          }
          case 'url': props.url = element.querySelector('img, video, audio')?.getAttribute('src'); break;
          case 'name': props.name = element.querySelector('i')?.textContent.trim(); break;
          case 'axis': props.axis = element.querySelector('[role="separator"], hr')?.getAttribute('aria-orientation') ?? 'horizontal'; break;
          case 'value': props.value = nativeValue(element, value); break;
          case 'state': props.state = element.node?.state; break;
          case 'children': {
            const children = childComponents(element);
            const pending = window.fixture.pendingChildren(element.node);
            let index = 0;
            props.children = value.map(shape => {
              if (shape.state === 'pending') {
                const node = pending.find(child => child.componentId === shape.id);
                if (node) return {id: node.componentId, state: node.state};
                return {missingPending: shape.id};
              }
              const child = children[index++];
              return child ? read(child, shape) : {missing: shape.id};
            });
            for (const extra of children.slice(index)) {
              props.children.push({unexpectedChild: component(extra)?.id});
            }
            break;
          }
          default: throw new Error('Unsupported fixture field: ' + key);
        }
      }
      return shape ? props : {unexpectedChild: component(element)?.id};
    };
    const host = [...document.querySelectorAll('a2ui-surface')].find(view => !surfaceId || view.surface?.id === surfaceId);
    const root = host && childComponents(host).find(node => component(node).id === expected.id);
    return root && read(root, expected);
  }, {expected, surfaceId});
  assert.deepEqual(actual, expected);
}

export async function userInput(page, step) {
  const value = step.inputValue;
  if (step.targetNode === 'root') {
    await page.getByRole('tab').nth(value).click();
    return;
  }
  await page.evaluate(() => window.fixture.markInputs());
  const component = page.locator('[data-fixture-component="' + step.targetNode + '"]');
  if (typeof value === 'boolean') {
    await component.getByRole('checkbox').setChecked(value);
  } else if (Array.isArray(value)) {
    for (const selection of value) await component.locator('input[value="' + selection + '"]').check();
  } else if (typeof value === 'number') {
    await component.getByRole('slider').fill(String(value));
  } else if (await component.locator('input[type="date"]').count()) {
    const [date, time] = value.split('T');
    await component.locator('input[type="date"]').fill(date);
    if (time) await component.locator('input[type="time"]').fill(time.slice(0, 5));
  } else {
    await component.getByRole('textbox').fill(value);
  }
}

export function matchOutput(actual, expected) {
  if (expected?.$match === 'any') {
    assert.equal(typeof actual, 'string');
    assert.ok(actual.length > 0);
    return actual;
  }
  if (expected === null || typeof expected !== 'object') return expected;
  if (Array.isArray(expected)) return expected.map((entry, index) => matchOutput(actual?.[index], entry));
  return Object.fromEntries(Object.entries(expected).map(([key, value]) =>
    [key, matchOutput(actual?.[key], value)]));
}
