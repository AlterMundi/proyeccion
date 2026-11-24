import {html, nothing} from 'lit';
import {A2uiExpressionError} from '@a2ui/web_core';
import {basicCatalog} from './protocol.js';

const checkableNames = ['Button', 'CheckBox', 'ChoicePicker', 'DateTimeInput', 'Slider', 'TextField'];
const nativeControlFixes = new Map([
  ['ChoicePicker', isolateChoiceGroup],
  ['DateTimeInput', clearableDateTime],
]);

const hintComponents = new Map(checkableNames.map(name => {
  const {element: Element, tagName} = basicCatalog.components.get(name);
  class WithValidationHints extends Element {
    render() {
      const hints = this.controller?.props?.validationResults?.filter(result =>
        (result.severity === 'warning' || result.severity === 'info') && result.message);
      return html`
        ${super.render()}
        ${hints?.length ? html`
          <ul class="proyeccion-validation-hints" aria-live="polite">
            ${hints.map(hint => html`<li class="proyeccion-validation-hint"
              data-severity=${hint.severity}>${hint.message}</li>`)}
          </ul>` : nothing}
      `;
    }
  }
  const element = nativeControlFixes.get(name)?.(WithValidationHints) ?? WithValidationHints;
  return [name, {base: Element, element, tagName: 'proyeccion-' + tagName}];
}));

function isolateChoiceGroup(Element) {
  return class extends Element {
    updated(changedProperties) {
      super.updated(changedProperties);
      // Native radio groups are shared by the document. A2UI IDs can repeat
      // across connections, whereas the SDK's node DOM ID is document-unique.
      const groupName = `proyeccion-${this.domId}-choices`;
      for (const radio of this.querySelectorAll('input.a2ui-option-input[type="radio"]')) {
        if (radio.name !== groupName) radio.name = groupName;
      }
    }
  };
}

function clearableDateTime(Element) {
  return class extends Element {
    constructor() {
      super();
      this.addEventListener('change', event => {
        const {type, value} = event.target;
        const props = this.controller?.props;
        if (value !== '' || (type !== 'date' && type !== 'time') || !props?.enableDate || !props.enableTime) return;
        // The combined Lit handler would append the other half to the cleared value.
        event.stopPropagation();
        props.setValue?.('');
      }, {capture: true});
    }
  };
}

export function prepareBrowserCatalog(catalog, hasUserGesture) {
  let changed = false;
  const components = [...catalog.components.values()].map(component => {
    const hints = hintComponents.get(component.name);
    if (!hints || hints.base !== component.element) return component;
    changed = true;
    return {...component, element: hints.element, tagName: hints.tagName};
  });
  const gated = [...catalog.functions.values()].some(fn => fn.requiresUserActivation);
  if (!changed && !gated) return catalog;

  const prepared = catalog.copyWith({components});
  if (gated) {
    const invoke = prepared.invoker;
    prepared.invoker = (name, ...args) => {
      if (prepared.functions.get(name)?.requiresUserActivation && !hasUserGesture()) {
        throw new A2uiExpressionError(`Function '${name}' requires an active user gesture.`, name);
      }
      return invoke(name, ...args);
    };
  }
  return prepared;
}
