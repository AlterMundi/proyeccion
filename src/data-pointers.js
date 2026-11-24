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
