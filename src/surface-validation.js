import {NodeResolver, effect, getValue} from '@a2ui/web_core';
import {trackActionTimes} from './action-timing.js';
import {isBasicButton} from './browser-catalog.js';
import {installPointerContext} from './data-pointers.js';

const defaultMessage = 'Validation failed';
const missingMessage = Symbol('missing CheckRule message');
const pendingFallback = Symbol('pending CheckRule fallback');

class ValidationResolver extends NodeResolver {
  registerNode(node, options) {
    const binder = options.binder;
    if (binder) {
      installPointerContext(binder.context.dataContext);
      trackActionTimes(binder.context.dataContext);
      const bind = binder.bindCheckCondition.bind(binder);
      const evaluate = binder.checkResultOf.bind(binder);
      const extract = binder.extractValidationResult.bind(binder);
      binder.extractValidationResult = (value, ...options) => {
        const result = extract(value, ...options);
        if (!value || typeof value !== 'object' || typeof value.valid !== 'boolean') return result;
        // Web Core only returns standard fields. Specialized components also
        // need domain details on a result supplied by a binding or function.
        const {valid: _valid, code: _code, message: _message, severity: _severity, ...details} = value;
        return {...details, ...result};
      };
      // Web Core 0.16.1 treats function messages as overrides and discards
      // the invocation failure text. Keep the original resolver's value,
      // subscription and error handling while fixing message precedence.
      binder.bindCheckCondition = (condition, once, setResult, update, ruleMessage, fallback) => {
        const message = ruleMessage === undefined && fallback === defaultMessage ? missingMessage : fallback;
        // Web Core emits a synthetic valid result with the supplied fallback
        // while a call is pending. Give that result a unique marker and
        // normalize the real result when the call settles.
        const marker = {[pendingFallback]: message};
        const disableWhilePending = isBasicButton(node.impl);
        let lastSettled;
        return bind(condition, once, result => {
          if (result.message === marker && result.valid) {
            setResult(disableWhilePending
              ? {valid: false, message: '', severity: 'error'}
              : lastSettled ?? {valid: true, message: '', severity: 'error'});
            return;
          }
          const resolvedMessage = result.message === marker ? message : result.message;
          lastSettled = {...result, message: resolvedMessage === missingMessage ? defaultMessage : resolvedMessage};
          setResult(lastSettled);
        }, update, undefined, marker);
      };
      binder.checkResultOf = (value, override, fallback) => {
        const result = evaluate(value, override, fallback?.[pendingFallback] ?? fallback);
        if (!result.valid && result.message === missingMessage) {
          const cause = value?.error;
          if (cause instanceof Error) {
            const message = cause.rawMessage ?? cause.message;
            if (typeof message === 'string') return {...result, message};
          }
        }
        return result;
      };
    }
    return super.registerNode(node, options);
  }
}

// Keep Lit's normal connection and cleanup hooks. Select our resolver
// only on the views this renderer owns.
export function installSurfaceValidation(view) {
  view.subscribeToRoot = () => {
    view.unsubscribe?.();
    view.unsubscribe = undefined;
    view._rootNode = undefined;
    if (!view.surface) return;
    const resolver = new ValidationResolver(view.surface);
    const stop = effect(() => { view._rootNode = getValue(resolver.rootNode); });
    view.unsubscribe = () => {
      stop();
      resolver.dispose();
    };
  };
}
