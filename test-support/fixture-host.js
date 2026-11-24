import {PerspectiveCamera, Scene} from 'three';
import {getValue} from '@a2ui/web_core';
import {createProyeccion} from 'proyeccion';

const viewport = document.querySelector('#viewport');
const scene = new Scene();
const camera = new PerspectiveCamera(42, viewport.clientWidth / viewport.clientHeight, 0.01, 40);
camera.position.z = 5;
const outbound = [];
const failures = [];
const projection = createProyeccion({
  parent: scene,
  viewport,
  send: (message, metadata) => outbound.push({message, metadata}),
  onTransportError: error => failures.push(error.message),
});
projection.render(camera);
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
  projection, outbound, failures, markInputs, compareViews,
  snapshot() { prior = readViews(); },
  pendingChildren(node) {
    const props = getValue(node.props);
    return (props.children ?? (props.child ? [props.child] : [])).filter(child => child.isPlaceholder);
  },
};
