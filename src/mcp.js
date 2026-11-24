import {A2uiMcpApp, configureMcpCatalog, mcpCatalog} from '@a2ui/catalog-mcp';
import {A2uiExpressionError} from '@a2ui/web_core';
import {componentActionAliases} from './catalog.js';
import {mcpAppPayload, readToolResources, visibleMcpContent} from './mcp-resources.js';
import {createMcpTransportBinding} from './mcp-transport.js';

const policies = new WeakMap();
const sdkMessageAction = 'a2ui.mcpAppMessage';
const pinnedMessageAction = 'ui/message';

class ProyeccionMcpApp extends A2uiMcpApp.element {
  #bridgeSignal;
  #bridgePaths;

  #dataPaths() {
    return JSON.stringify(Object.entries(this.controller.props.data?.paths ?? {}).sort());
  }

  updated(changes) {
    super.updated(changes);
    // The SDK captures data.paths when it starts the bridge. A new path
    // mapping needs a new bridge even when the authorized HTML is unchanged.
    const frame = this.frameElement;
    if (frame && this.context && this.#bridgePaths !== this.#dataPaths()) {
      this.endSession();
      this.startSession(frame);
    }
  }

  resolveResource() {
    const resource = super.resolveResource();
    const {componentModel, dataContext} = this.context ?? {};
    const policy = policies.get(componentModel?.catalog ?? dataContext?.surface?.defaultCatalog);
    const {authorizeApp, messageActionName} = policy ?? {};
    if (!resource || !authorizeApp || !componentModel || !dataContext) return null;
    const {allowedTools, allowedFunctions, data} = this.controller.props;
    // The SDK sends fallback tools and messages through the same action dispatcher.
    if (messageActionName === pinnedMessageAction &&
        allowedTools?.some(name => name === sdkMessageAction || name === pinnedMessageAction)) return null;
    const request = {
      surfaceId: dataContext.surface.id,
      componentId: componentModel.id,
      resource, allowedTools, allowedFunctions, data,
    };
    return authorizeApp(request) === true ? resource : null;
  }

  connectFrame(frame, origin) {
    const lifetime = new AbortController();
    this.#bridgeSignal = lifetime.signal;
    this.#bridgePaths = this.#dataPaths();
    const disconnect = super.connectFrame(frame, origin);
    return () => {
      lifetime.abort();
      disconnect();
    };
  }

  resolveCallTool() {
    const context = this.context;
    const {componentModel, dataContext} = context ?? {};
    const surface = dataContext?.surface;
    const {resolveTool} = policies.get(componentModel?.catalog ?? surface?.defaultCatalog) ?? {};
    if (!resolveTool || !surface || !componentModel) return undefined;
    const signal = this.#bridgeSignal;
    return async (name, input) => {
      const checkActive = () => {
        signal.throwIfAborted();
        if (surface.disposed || this.context !== context || !this.resolveResource()
            || !this.controller.props.allowedTools?.includes(name)) {
          throw new Error('The MCP App tool is no longer available.');
        }
      };
      const request = {name, arguments: input, surfaceId: surface.id, componentId: componentModel.id};
      const {result} = await callApprovedTool(resolveTool, request, checkActive, signal);
      return {...result, content: visibleMcpContent(result)};
    };
  }
}

async function callApprovedTool(resolveTool, request, checkActive, signal) {
  checkActive();
  const client = await resolveTool(request);
  checkActive();
  if (!client) throw new A2uiExpressionError('The host did not authorize this MCP tool.', 'callMcpTool');
  const result = await client.callTool({name: request.name, arguments: request.arguments}, undefined, {signal});
  checkActive();
  return {client, result};
}

/** Configure only the location of the upstream sandbox proxy for this page. */
export function configureMcpSandbox(sandbox) {
  configureMcpCatalog({sandbox});
}

/** Install the MCP catalog with an explicit host policy for each resolved app. */
export function createMcpAppCatalog({authorizeApp, messageActionName} = {}) {
  return buildCatalog({authorizeApp, messageActionName});
}

function buildCatalog({authorizeApp, execute, resolveTool, messageActionName = sdkMessageAction}) {
  if (typeof authorizeApp !== 'function') throw new TypeError('An MCP App authorization callback is required');
  if (messageActionName !== sdkMessageAction && messageActionName !== pinnedMessageAction) {
    throw new TypeError('MCP App messageActionName must be a2ui.mcpAppMessage or ui/message');
  }
  const functions = [...mcpCatalog.functions.values()].map(fn => {
    if (fn.name !== 'callMcpTool') return fn;
    // Leave the canonical signature available for ordinary agent RPC fallback.
    const {execute: _execute, ...declaration} = fn;
    return execute ? {...declaration, execute} : declaration;
  });
  const catalog = mcpCatalog.copyWith({
    components: [{...A2uiMcpApp, tagName: 'proyeccion-mcp-app', element: ProyeccionMcpApp}],
    functions,
  });
  if (messageActionName === pinnedMessageAction) {
    componentActionAliases.set(catalog.components.get('McpApp'), new Map([[sdkMessageAction, pinnedMessageAction]]));
  }
  policies.set(catalog, {authorizeApp, resolveTool, messageActionName});
  return catalog;
}

function jsonContainer(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}

function toolPayload(name, input, result) {
  const content = visibleMcpContent(result);
  const blocks = content.filter(part => part.type === 'text').map(part => part.text);
  const payload = {toolName: name, toolInput: input, toolResult: {...result, content}};
  if (result.structuredContent !== undefined) payload.structuredContent = result.structuredContent;
  if (blocks.length) {
    payload.text = blocks.join('\n');
    const json = jsonContainer(payload.text);
    if (json !== undefined) payload.json = json;
    else if (blocks.length > 1) {
      const parsed = blocks.map(jsonContainer).filter(value => value !== undefined);
      if (parsed.length) payload.json = parsed;
    }
  }
  return payload;
}

/** Add the MCP catalog with a direct tool route scoped to this renderer. */
export function installMcpAppCatalog(renderer, {
  authorizeApp, resolveTool, authorizeResource, onTransportError, messageActionName,
} = {}) {
  if (typeof resolveTool !== 'function') throw new TypeError('An MCP tool route callback is required');
  if (authorizeResource !== undefined && typeof authorizeResource !== 'function') {
    throw new TypeError('MCP resource authorization must be a callback');
  }
  const latest = new WeakMap();
  const ingress = createMcpTransportBinding(renderer, {onTransportError});
  const execute = async ({name, arguments: input = {}, targetDataPath}, context, signal) => {
    if (!context.isActionExecution || !context.surface) {
      throw new A2uiExpressionError('Direct MCP tools require a surface action.', 'callMcpTool');
    }
    const {surface} = context;
    const checkActive = () => {
      signal?.throwIfAborted();
      if (surface.disposed) throw new A2uiExpressionError('The MCP tool surface has closed.', 'callMcpTool');
    };
    checkActive();
    const path = targetDataPath === undefined ? undefined : context.resolvePath(targetDataPath);
    let pending;
    if (path !== undefined) {
      pending = latest.get(surface);
      if (!pending) latest.set(surface, pending = new Map());
    }
    const call = {};
    pending?.set(path, call);
    const isCurrent = () => !surface.disposed && !signal?.aborted && (!pending || pending.get(path) === call);
    try {
      const request = {name, arguments: input, surfaceId: surface.id};
      const {client, result} = await callApprovedTool(resolveTool, request, checkActive, signal);
      if (result.isError) throw new A2uiExpressionError('The MCP tool reported a failure.', 'callMcpTool');
      const payload = toolPayload(name, input, result);
      if (!isCurrent()) return payload;
      const linked = await readToolResources(client, result, request, authorizeResource, {signal, isCurrent});
      checkActive();
      if (isCurrent()) {
        const embedded = visibleMcpContent(result).filter(part => part.type === 'resource')
          .map(part => ({resource: part.resource, ui: part.resource._meta?.ui ?? part._meta?.ui}));
        for (const item of [...linked, ...embedded]) Object.assign(payload, mcpAppPayload(item));
        for (const {resource} of linked) ingress.receiveResource(resource, {reuseLayout: true});
        ingress.receiveToolResult(result);
        if (path !== undefined && !surface.disposed) context.set(targetDataPath, payload);
      }
      return payload;
    } finally {
      if (pending?.get(path) === call) pending.delete(path);
    }
  };
  const catalog = buildCatalog({authorizeApp, execute, resolveTool, messageActionName});
  renderer.addCatalog(catalog);
  return catalog;
}
