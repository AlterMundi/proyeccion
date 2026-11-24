import {GridHelper, PerspectiveCamera, Raycaster, Scene, Vector2, WebGLRenderer} from 'three';
import {createProyeccion, basicCatalog} from 'proyeccion';
import {createWorkbench, workbenchData, workbenchSurface} from './workbench-model.js';

const viewport = document.querySelector('#viewport');
const scene = new Scene();
const camera = new PerspectiveCamera(42, 1, 0.01, 75);
const grid = new GridHelper(16, 32, 0x527a76, 0x2d4648);
grid.position.y = -1.05;
scene.add(grid);

let webgl;
try {
  webgl = new WebGLRenderer({alpha: true, antialias: true});
  webgl.setPixelRatio(Math.min(devicePixelRatio, 2));
  viewport.append(webgl.domElement);
} catch {
  // CSS3D controls remain available without a WebGL context.
}

const model = createWorkbench();
const location = model.human.locate();
const sent = [];
const failures = [];
const projection = createProyeccion({
  parent: scene,
  viewport,
  send(message, metadata) {
    sent.push({message, metadata});
    const action = message.action;
    if (action?.name === 'applyTitle') {
      if (action.surfaceId !== location.projectionId) return;
      model.human.rename({
        subjectRef: location.subjectRef,
        expectedRevision: action.context.revision,
        title: action.context.title,
      });
    }
  },
  onTransportError(error) { failures.push(error.message); },
});
projection.group.rotation.y = -0.09;
const unsubscribe = model.subscribe(state => {
  projection.receive({
    version: '1.0',
    updateDataModel: {
      surfaceId: location.projectionId,
      value: workbenchData(state),
    },
  });
});

function draw() {
  if (!viewport.clientWidth || !viewport.clientHeight) return;
  const {clientWidth: width, clientHeight: height} = viewport;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  webgl?.setSize(width, height);
  webgl?.render(scene, camera);
  projection.render(camera);
}
let alternate = false;
function moveCamera() {
  const distance = Math.max(3.4, 2.65 * viewport.clientHeight / viewport.clientWidth);
  camera.position.set(alternate ? 0.65 : -0.25, 0.23, distance);
  camera.lookAt(0, 0, 0);
  draw();
}

const observer = new ResizeObserver(moveCamera);
observer.observe(viewport);
document.querySelector('#angle').addEventListener('click', () => {
  alternate = !alternate;
  projection.group.rotation.y = alternate ? 0.17 : -0.09;
  moveCamera();
});

projection.receive(workbenchSurface(location.projectionId, basicCatalog.id, model.human.read(location.subjectRef)));
moveCamera();

// A local interoperability example exposes the host boundary to browser tests.
export const workspace = {
  projection, sent, failures, scene, grid, companion: model.companion,
  activateAt(x, y) {
    const bounds = viewport.getBoundingClientRect();
    const cursor = new Vector2(
      (x - bounds.left) * 2 / bounds.width - 1,
      1 - (y - bounds.top) * 2 / bounds.height,
    );
    const raycaster = new Raycaster();
    raycaster.setFromCamera(cursor, camera);
    return projection.activateRay(raycaster.ray, camera);
  },
  dispose() {
    observer.disconnect();
    unsubscribe();
    projection.dispose();
    webgl?.dispose();
  },
};
