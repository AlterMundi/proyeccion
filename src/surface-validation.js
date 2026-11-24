import {NodeResolver, effect, getValue} from '@a2ui/web_core';

class ValidationResolver extends NodeResolver {
  registerNode(node, options) {
    const binder = options.binder;
    if (binder) {
      const bind = binder.bindCheckCondition.bind(binder);
      // A2UI 1.0 uses the rule text as a fallback. Web Core 0.16.1
      // passes it as a higher-priority override for function results.
      binder.bindCheckCondition = (condition, once, setResult, update, _override, fallback) =>
        bind(condition, once, setResult, update, undefined, fallback);
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
