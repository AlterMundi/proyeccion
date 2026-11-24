import {A2uiMcpApp, configureMcpCatalog, mcpCatalog} from '@a2ui/catalog-mcp';

const policies = new WeakMap();

class ProyeccionMcpApp extends A2uiMcpApp.element {
  resolveResource() {
    const resource = super.resolveResource();
    const {componentModel, dataContext} = this.context ?? {};
    const authorizeApp = policies.get(componentModel?.catalog ?? dataContext?.surface?.defaultCatalog);
    if (!resource || !authorizeApp || !componentModel || !dataContext) return null;
    const {allowedTools, allowedFunctions, data} = this.controller.props;
    const request = {
      surfaceId: dataContext.surface.id,
      componentId: componentModel.id,
      resource, allowedTools, allowedFunctions, data,
    };
    return authorizeApp(request) === true ? resource : null;
  }

  resolveCallTool() {
    // The bridge emits an A2UI action for a listed tool. The host owns execution.
    return undefined;
  }
}

/** Configure only the location of the upstream sandbox proxy for this page. */
export function configureMcpSandbox(sandbox) {
  configureMcpCatalog({sandbox});
}

/** Install the MCP catalog with an explicit host policy for each resolved app. */
export function createMcpAppCatalog({authorizeApp} = {}) {
  if (typeof authorizeApp !== 'function') throw new TypeError('An MCP App authorization callback is required');
  const functions = [...mcpCatalog.functions.values()].map(fn => {
    if (fn.name !== 'callMcpTool') return fn;
    // Leave the canonical signature available for ordinary agent RPC fallback.
    const {execute, ...declaration} = fn;
    return declaration;
  });
  const catalog = mcpCatalog.copyWith({
    components: [{...A2uiMcpApp, tagName: 'proyeccion-mcp-app', element: ProyeccionMcpApp}],
    functions,
  });
  policies.set(catalog, authorizeApp);
  return catalog;
}
