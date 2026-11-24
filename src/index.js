import '@a2ui/lit';
import {renderMarkdown} from '@a2ui/markdown-it';
import {Context} from '@a2ui/web_core/catalogs/basic/v1';
import {ContextProvider} from '@lit/context';
import {Matrix4, Plane, Ray, Vector3, Group} from 'three';
import {CSS3DObject, CSS3DRenderer} from 'three/addons/renderers/CSS3DRenderer.js';
import {createProtocol, basicCatalog} from './protocol.js';

export {basicCatalog};

const plane = new Plane(new Vector3(0, 0, 1), 0);
const controls = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]';

function controlAt(document, x, y) {
  let element = document.elementFromPoint(x, y);
  while (element?.shadowRoot) {
    const child = element.shadowRoot.elementFromPoint(x, y);
    if (!child || child === element) break;
    element = child;
  }
  return element?.closest(controls);
}

function contains(panel, element) {
  for (let node = element; node; node = node.parentNode ?? node.host) {
    if (node === panel) return true;
  }
  return false;
}

/**
 * Mount A2UI surfaces as CSS3D objects aligned with the host's Three.js scene.
 * The viewport should be a positioned element matching the host camera viewport.
 * One instance is scoped to one trusted agent and one ordered transport.
 */
export function createProyeccion({
  parent, viewport, placeSurface = () => {}, ...transport
}) {
  const document = viewport.ownerDocument;
  const group = new Group();
  group.name = 'Proyeccion';
  parent.add(group);

  const layer = document.createElement('div');
  layer.className = 'proyeccion-layer';
  Object.assign(layer.style, {position: 'absolute', inset: '0', pointerEvents: 'none'});
  viewport.append(layer);
  const renderer = new CSS3DRenderer({element: layer});
  const surfaces = new Map();
  let disposed = false;
  let lastCamera;

  function removeSurface(id) {
    const surface = surfaces.get(id);
    if (!surface) return;
    surface.view.surface = undefined;
    surface.panel.remove();
    surface.object.removeFromParent();
    surfaces.delete(id);
  }

  const protocol = createProtocol({
    ...transport,
    onSurfaceCreated(surface) {
      const panel = document.createElement('div');
      panel.className = 'proyeccion-surface';
      const view = document.createElement('a2ui-surface');
      new ContextProvider(view, {context: Context.markdown, initialValue: renderMarkdown});
      view.surface = surface;
      panel.append(view);

      const object = new CSS3DObject(panel);
      object.name = surface.id;
      object.scale.setScalar(0.005);
      placeSurface(object, surface.id, surfaces.size);
      group.add(object);
      surfaces.set(surface.id, {object, panel, view});
      if (lastCamera) render(lastCamera);
    },
    onSurfaceDeleted: removeSurface,
  });

  function render(camera) {
    if (disposed) return;
    lastCamera = camera;
    const {clientWidth: width, clientHeight: height} = viewport;
    if (!width || !height) return;
    const size = renderer.getSize();
    if (width !== size.width || height !== size.height) renderer.setSize(width, height);
    group.updateWorldMatrix(true, true);
    camera.updateWorldMatrix(true, false);
    renderer.render(group, camera);
  }

  // Host rays can mirror browser hit testing without a second set of controls.
  // Call once from the host's input handler, never alongside a native DOM click.
  function activateRay(ray, camera) {
    if (disposed) return false;
    render(camera);
    const bounds = layer.getBoundingClientRect();
    const hits = [];
    for (const surface of surfaces.values()) {
      if (!surface.panel.isConnected || !surface.object.visible) continue;
      const inverse = new Matrix4().copy(surface.object.matrixWorld).invert();
      const local = new Ray().copy(ray).applyMatrix4(inverse).intersectPlane(plane, new Vector3());
      if (!local || Math.abs(local.x) > surface.panel.offsetWidth / 2
        || Math.abs(local.y) > surface.panel.offsetHeight / 2) continue;
      const point = local.applyMatrix4(surface.object.matrixWorld);
      hits.push({surface, point, distance: point.distanceToSquared(ray.origin)});
    }
    hits.sort((left, right) => left.distance - right.distance);
    for (const {surface, point} of hits) {
      point.project(camera);
      if (point.z < -1 || point.z > 1) continue;
      const x = bounds.left + ((point.x + 1) / 2) * bounds.width;
      const y = bounds.top + ((1 - point.y) / 2) * bounds.height;
      const control = controlAt(document, x, y);
      if (!contains(surface.panel, control)) continue;
      control.focus({preventScroll: true});
      control.click();
      return true;
    }
    return false;
  }

  return {
    ...protocol, group, render, activateRay,
    dispose() {
      if (disposed) return;
      disposed = true;
      lastCamera = undefined;
      for (const id of surfaces.keys()) removeSurface(id);
      protocol.dispose();
      group.removeFromParent();
      layer.remove();
    },
  };
}
