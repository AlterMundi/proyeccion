import '@a2ui/lit';
import {renderMarkdown} from '@a2ui/markdown-it';
import {Context} from '@a2ui/web_core/catalogs/basic/v1';
import {ContextProvider} from '@lit/context';
import {Matrix4, Plane, Ray, Vector3, Group} from 'three';
import {CSS3DObject, CSS3DRenderer} from 'three/addons/renderers/CSS3DRenderer.js';
import {createProtocol, basicCatalog} from './protocol.js';
import {prepareBrowserCatalog} from './browser-catalog.js';
import {bindModalFocus} from './modal-focus.js';
import {installSurfaceValidation} from './surface-validation.js';

export {basicCatalog};
export {loadCatalog} from './catalog.js';
export {A2UI_A2A_EXTENSION, createA2aBinding} from './a2a.js';
export {createAgUiActivityBinding, withAgUiAction} from './ag-ui.js';
export {createHttpLiveBinding} from './http-live.js';
export {createMcpTransportBinding} from './mcp-transport.js';
export {createSseJsonRpcBinding} from './sse-jsonrpc.js';

const plane = new Plane(new Vector3(0, 0, 1), 0);
const iconFonts = new WeakSet();
const materialIcons = new URL('./assets/material-icons/MaterialIcons-Regular.ttf', import.meta.url);

function registerIconFont(document) {
  const fonts = document.fonts;
  const FontFace = document.defaultView?.FontFace;
  if (!fonts || !FontFace || iconFonts.has(fonts)) return;
  // One lazily loaded, bundled face per document. The host may still
  // select another family with the Basic Catalog's CSS variable.
  fonts.add(new FontFace('Proyeccion Material Icons', 'url("' + materialIcons.href + '")'));
  iconFonts.add(fonts);
}
const gestureEvents = new Set(['click', 'pointerdown', 'pointerup', 'mousedown', 'touchend', 'keydown']);
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
  parent, viewport, placeSurface = () => {}, catalogs = [basicCatalog], ...transport
}) {
  const document = viewport.ownerDocument;
  async function renderBasicMarkdown(value, options) {
    // Keep the upstream formatting and sanitizer. Flatten links and images
    // before inserting the Basic Catalog text into the live document.
    const template = document.createElement('template');
    template.innerHTML = await renderMarkdown(value, options);
    for (const link of template.content.querySelectorAll('a')) link.replaceWith(...link.childNodes);
    for (const image of template.content.querySelectorAll('img')) image.replaceWith(image.alt);
    return template.innerHTML;
  }
  const group = new Group();
  group.name = 'Proyeccion';

  const layer = document.createElement('div');
  layer.className = 'proyeccion-layer';
  Object.assign(layer.style, {position: 'absolute', inset: '0', pointerEvents: 'none'});
  const renderer = new CSS3DRenderer({element: layer});
  const surfaces = new Map();
  let disposed = false;
  let lastCamera;
  let click;
  let rayGesture;
  // A native dispatch may run microtasks between capture and target.
  // eventPhase becomes NONE when the original dispatch ends.
  layer.addEventListener('click', event => { click = event; }, {capture: true});
  const activeEvent = event => event?.isTrusted && event.eventPhase !== 0 && gestureEvents.has(event.type);
  const hasUserGesture = () => Boolean((activeEvent(click) || activeEvent(rayGesture))
    && (document.defaultView?.navigator.userActivation?.isActive ?? true));

  function removeSurface(id) {
    const surface = surfaces.get(id);
    if (!surface) return;
    surface.stopModalFocus();
    surface.view.surface = undefined;
    surface.panel.remove();
    surface.object.removeFromParent();
    surfaces.delete(id);
  }

  const protocol = createProtocol({
    ...transport,
    catalogs: catalogs.map(catalog => prepareBrowserCatalog(catalog, hasUserGesture)),
    onSurfaceCreated(surface) {
      const panel = document.createElement('div');
      panel.className = 'proyeccion-surface';
      panel.style.setProperty('--a2ui-icon-font-family',
        'var(--proyeccion-icon-font-family, "Proyeccion Material Icons")');
      const view = document.createElement('a2ui-surface');
      installSurfaceValidation(view);
      new ContextProvider(view, {context: Context.markdown, initialValue: renderBasicMarkdown});
      panel.append(view);

      const object = new CSS3DObject(panel);
      object.name = surface.id;
      object.scale.setScalar(0.005);
      placeSurface(object, surface.id, surfaces.size);
      group.add(object);
      const stopModalFocus = bindModalFocus(panel);
      surfaces.set(surface.id, {object, panel, view, model: surface, stopModalFocus});
      if (lastCamera) render(lastCamera);
    },
    onSurfaceDeleted: removeSurface,
  });
  registerIconFont(document);
  parent.add(group);
  viewport.append(layer);

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
    for (const {view, model} of surfaces.values()) {
      // Attach the model after CSS3D connects the view. Otherwise Lit
      // creates a resolver in both connectedCallback and willUpdate.
      if (view.isConnected && !view.surface) view.surface = model;
    }
  }

  // Host rays can mirror browser hit testing without a second set of controls.
  // Call once from the host's input handler, never alongside a native DOM click.
  function activateRay(ray, camera, inputEvent) {
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
      const previousGesture = rayGesture;
      rayGesture = inputEvent;
      try {
        control.click();
      } finally {
        rayGesture = previousGesture;
      }
      return true;
    }
    return false;
  }

  return {
    ...protocol, group, render, activateRay,
    addCatalog(catalog) {
      protocol.addCatalog(prepareBrowserCatalog(catalog, hasUserGesture));
    },
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
