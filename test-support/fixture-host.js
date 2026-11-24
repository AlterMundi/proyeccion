import {PerspectiveCamera, Scene} from 'three';
import {A2uiLitElement} from '@a2ui/lit';
import {Catalog} from '@a2ui/web_core/catalog';
import {z} from 'zod';
import {getValue} from '@a2ui/web_core';
import {
  basicCatalog, createA2aBinding, createAgUiActivityBinding, createHttpLiveBinding,
  createMcpTransportBinding, createProyeccion, createSseJsonRpcBinding,
} from 'proyeccion';

const viewport = document.querySelector('#viewport');
const scene = new Scene();
const camera = new PerspectiveCamera(42, viewport.clientWidth / viewport.clientHeight, 0.01, 40);
camera.position.z = 5;
const outbound = [];
const failures = [];
function mount(catalogs, target = viewport, maxAgentCallCacheEntries) {
  const projection = createProyeccion({
    parent: scene, viewport: target, catalogs, maxAgentCallCacheEntries,
    send: (message, metadata) => outbound.push({message, metadata}),
    onTransportError: error => failures.push(error.message),
  });
  projection.render(camera);
  return projection;
}

class StatusBadge extends A2uiLitElement {
  createRenderRoot() { return this; }
  render() { return this.controller?.props.badgeText ?? ''; }
}

const statusBadge = {
  name: 'StatusBadge', tagName: 'fixture-status-badge', element: StatusBadge,
  schema: z.object({badgeText: z.string()}),
};

function configure({increment, failAction, secondary, maxAgentCallCacheEntries}) {
  const localFunctions = [];
  if (increment) localFunctions.push({
    name: 'incrementCounter',
    returnType: 'void',
    schema: z.object({path: z.string(), step: z.any()}),
    execute({path, step}, {dataModel}) { dataModel.set(path, dataModel.get(path) + step); },
  });
  if (failAction) localFunctions.push({
    name: 'failingAction',
    returnType: 'void',
    schema: z.object({}),
    execute() { throw new Error('Local action failed'); },
  });
  const catalogs = [localFunctions.length ? basicCatalog.withEntries(
    [...basicCatalog.components.values()], [...basicCatalog.functions.values(), ...localFunctions],
  ) : basicCatalog];
  for (const {catalogId, protocolVersion, components, functions} of secondary) {
    const entries = components?.StatusBadge ? [statusBadge] : [];
    const lookup = functions?.lookupAccount;
    const calls = lookup ? [{
      name: 'lookupAccount', returnType: lookup.returnType, allowedCallers: lookup.allowedCallers,
      schema: z.object({accountId: z.string()}).strict(),
    }] : [];
    catalogs.push(new Catalog(catalogId, protocolVersion, entries, calls));
  }
  projection.dispose();
  projection = mount(catalogs, viewport, maxAgentCallCacheEntries);
  window.fixture.projection = projection;
}

let projection = mount();
let prior;
function readViews() {
  const view = document.querySelector('a2ui-surface');
  const elements = [...(view?.querySelectorAll('*') ?? [])].filter(el => el.node);
  const byNode = new Map(elements.map(el => [el.node, el]));
  const views = new Map();
  function visit(node, path) {
    views.set(path, {element: byNode.get(node), node});
    const props = getValue(node.props);
    (props.children ?? (props.child ? [props.child] : []))
      .forEach((child, index) => visit(child, path + '/children/' + index));
  }
  if (view?.rootNode) visit(view.rootNode, 'root');
  return {surface: view?.surface, views};
}
function markInputs() {
  for (const element of document.querySelectorAll('a2ui-surface *')) {
    if (element.node) element.dataset.fixtureComponent = element.node.componentId;
  }
}
function compareViews(step) {
  const current = readViews();
  const outcomes = {};
  if (step.expectSameViewIdentity) outcomes.same = step.expectSameViewIdentity.map(path => {
    const before = prior.views.get(path)?.element;
    return Boolean(before && before === current.views.get(path)?.element);
  });
  if (step.expectNewViewIdentity) outcomes.changed = step.expectNewViewIdentity.map(path => {
    const before = prior.views.get(path)?.element;
    const after = current.views.get(path)?.element;
    return Boolean(before && after && before !== after && !before.isConnected);
  });
  if (step.expectDisposedNodes) outcomes.disposed = step.expectDisposedNodes.map(id => {
    const before = [...prior.views.values()].find(view => view.node.componentId === id);
    return Boolean(before?.node.disposed && !before.element?.isConnected);
  });
  if (step.expectSurfaceRemoved !== undefined) {
    outcomes.removed = Boolean(prior.surface?.disposed && !current.surface && !projection.group.children.length);
  }
  if (step.expectActiveSubscriptions !== undefined) {
    const surface = prior.surface;
    outcomes.surfaceDisposed = surface.disposed;
    outcomes.subscriptions = surface.componentsModel.onCreated.listeners.size
      + surface.componentsModel.onDeleted.listeners.size + surface.dataModel.subscriptions.size;
  }
  return outcomes;
}
window.fixture = {
  projection, outbound, failures, markInputs, compareViews, configure, mount,
  a2a(options) { return createA2aBinding(projection, options); },
  agUi(messageId) {
    return createAgUiActivityBinding({messageId, mount: () => mount(),
      onTransportError: error => failures.push(error.message)});
  },
  httpLive(options) {
    return createHttpLiveBinding({...options, mount(send) {
      const view = createProyeccion({parent: scene, viewport, send,
        onTransportError: error => failures.push(error.message)});
      view.render(camera);
      return view;
    }});
  },
  mcpTransport(client) {
    const view = createProyeccion({parent: scene, viewport, send: (envelope, metadata) => binding.send(envelope, metadata),
      onTransportError: error => failures.push(error.message)});
    const binding = createMcpTransportBinding(view, {client, perCallCapabilities: true,
      onTransportError: error => failures.push(error.message)});
    view.render(camera);
    return {binding, view};
  },
  sseTransport(options, readCatalogId) {
    const onTransportError = error => failures.push(error.message);
    const view = createProyeccion({parent: scene, viewport, onTransportError,
      send: (envelope, metadata) => binding.send(envelope, metadata)});
    view.addCatalog(new Catalog(readCatalogId, '1.0', [], [{
      name: 'readTitle', allowedCallers: 'rendererOrAgent', returnType: 'string',
      schema: z.object({title: z.string()}), execute: ({title}) => title,
    }]));
    const binding = createSseJsonRpcBinding(view, {...options, onTransportError});
    view.render(camera);
    return {binding, view};
  },
  addStatusCatalog(catalogId) { projection.addCatalog(new Catalog(catalogId, '1.0', [statusBadge])); },
  async addVegaChartCatalog() {
    const {vegaChartCatalog} = await import('proyeccion/vegachart');
    projection.addCatalog(vegaChartCatalog);
    return vegaChartCatalog.id;
  },
  async addMcpAppCatalog(authorizeApp) {
    const {createMcpAppCatalog} = await import('proyeccion/mcp');
    const catalog = createMcpAppCatalog({authorizeApp});
    projection.addCatalog(catalog);
    return catalog.id;
  },
  async addDirectMcpTools(resolveTool, {authorizeApp = () => false, authorizeResource, view = projection} = {}) {
    const {installMcpAppCatalog} = await import('proyeccion/mcp');
    return installMcpAppCatalog(view, {authorizeApp, resolveTool, authorizeResource,
      onTransportError: error => failures.push(error.message)}).id;
  },
  props(node) { return getValue(node.props); },
  metadata(node) { return getValue(node.metadata); },
  snapshot() { prior = readViews(); },
  pendingChildren(node) {
    const props = getValue(node.props);
    return (props.children ?? (props.child ? [props.child] : [])).filter(child => child.isPlaceholder);
  },
};
