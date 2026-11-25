import {OrthographicCamera, Raycaster, Scene, Vector2, WebGLRenderer} from 'three';
import {bindSpatialHudPointer, createSpatialHud, placeHudInViewport} from 'proyeccion/spatial-hud';

export function mountTableWorkbench(viewport, send) {
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.01, 20);
  camera.position.z = 4;
  const renderer = new WebGLRenderer({alpha: true, antialias: true});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Three.js workbench');
  viewport.append(canvas);
  let group, id;
  const hud = createSpatialHud({
    parent: scene, document, accessibilityRoot: viewport, controlStyle: 'optical', send,
    placeSurface(surface, surfaceId) { group = surface; id = surfaceId; },
  });
  const pointer = new Vector2();
  const ray = new Raycaster();
  const unbind = bindSpatialHudPointer({element: canvas, hud, rayForPointer(event) {
    const box = canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    pointer.set((event.clientX - box.left) / box.width * 2 - 1, 1 - (event.clientY - box.top) / box.height * 2);
    ray.setFromCamera(pointer, camera);
    return {ray: ray.ray};
  }});
  const events = new AbortController();
  canvas.addEventListener('keydown', event => {
    if (id && hud.handleKey(event, {surfaceId: id})) event.preventDefault();
  }, {signal: events.signal});

  let lastWidth, lastHeight;
  function draw() {
    const {clientWidth: width, clientHeight: height} = viewport;
    if (!width || !height) return;
    if (width !== lastWidth || height !== lastHeight) {
      renderer.setSize(width, height);
      lastWidth = width;
      lastHeight = height;
    }
    const pixelsPerUnit = Math.min(210, Math.floor((width - 24) / 2.35));
    if (group && pixelsPerUnit > 0) {
      hud.setTextDensity(id, {cssPixelsPerUnit: pixelsPerUnit, pixelRatio: renderer.getPixelRatio()});
      placeHudInViewport(group, camera, {width, height, pixelsPerUnit, x: width / 2,
        y: height / 2 - 0.43 * pixelsPerUnit, depth: 1});
    }
    hud.update();
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(draw);
  return {projection: hud, dispose() {
    renderer.setAnimationLoop(null);
    events.abort();
    unbind();
    hud.dispose();
    renderer.dispose();
    canvas.remove();
  }};
}
