import {DataModel} from '@a2ui/web_core';

function validateNewBranch(model, path) {
  const segments = model.parsePath(path);
  let parent = model.get('/') ?? {};
  for (let index = 0; index < segments.length - 1; index++) {
    if (typeof parent !== 'object') return;
    const key = segments[index];
    const child = Object.hasOwn(parent, key) ? parent[key] : undefined;
    if (child == null) {
      // Web Core can create ancestors before rejecting a later array index.
      // Reuse its setter on a detached container to validate the missing branch.
      const draft = new DataModel(Array.isArray(parent) ? [] : {});
      draft.parsePath = () => segments.slice(index);
      draft.set(path, true);
      return;
    }
    parent = child;
  }
}

// Web Core 0.16.1 collapses empty path segments. Keep its decoding and
// forbidden-key checks while retaining the empty keys in an A2UI 1.0 pointer.
export function installDataPointers(model) {
  const parse = model.parsePath.bind(model);
  model.parsePath = path => {
    const segments = parse(path);
    if (path === '' || path === '/') return segments;
    const tokens = (path.startsWith('/') ? path.slice(1) : path).split('/');
    let next = 0;
    return tokens.map(token => token === '' ? '' : segments[next++]);
  };
  model.normalizePath = path => path.startsWith('/') ? path : '/' + path;
  const set = model.set.bind(model);
  model.set = (path, value, preserveNull) => {
    if (typeof path === 'string' && path !== '' && path !== '/'
      && value !== undefined && (value !== null || preserveNull)) validateNewBranch(model, path);
    return set(path, value, preserveNull);
  };
}

export function installPointerContext(context) {
  const {resolvePath, nested} = context;
  context.resolvePath = function (path) {
    // A trailing slash on a non-root context points to an empty key. Appending
    // an item index or relative field must keep that part of the pointer.
    if (this.path !== '/' && this.path.endsWith('/') && !path.startsWith('/')) {
      return path === '' || path === '.' ? this.path : this.path + '/' + path;
    }
    return resolvePath.call(this, path);
  };
  context.nested = function (...args) {
    return installPointerContext(nested.apply(this, args));
  };
  return context;
}
