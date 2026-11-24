import {CameraManager, CollisionsManager} from '@mml-io/3d-web-client-core';
import {ThreeJSWorldRenderer} from '@mml-io/3d-web-threejs';
import {Group, PerspectiveCamera, Raycaster, Vector2} from 'three';
import * as spatialHud from 'proyeccion/spatial-hud';

const {bindSpatialHudPointer, createSpatialHud, spatialHudCatalog} = spatialHud;
const placeHudInViewport = Reflect.get(spatialHud, 'placeHudInViewport');

const target = document.querySelector('main');
const collisions = new CollisionsManager();
const camera = new CameraManager(target, collisions);
const pose = camera.getMainCameraState();
pose.position.set(0, 0, 3);
pose.rotation.set(0, 0, 0, 1);
const asset = name => new URL('/assets/anim_' + name + '.glb', location.href).href;
const renderer = new ThreeJSWorldRenderer({
  targetElement: target, coreCameraManager: camera, collisionsManager: collisions,
  mmlTargetWindow: window, mmlTargetElement: document.createElement('div'),
  loadingProgressManager: null, mmlDocuments: {}, mmlAuthToken: null,
  config: {
    animationConfig: {
      airAnimationFileUrl: asset('air'), doubleJumpAnimationFileUrl: asset('double_jump'),
      idleAnimationFileUrl: asset('idle'), jogAnimationFileUrl: asset('jog'), sprintAnimationFileUrl: asset('run'),
    },
    environmentConfiguration: {groundPlane: false},
    spawnSun: false, postProcessingEnabled: false,
  },
});
const parent = renderer.mmlCompositionScene.group;
const actions = [];
const errors = [];
let panel;
const projection = createSpatialHud({
  parent, document, accessibilityRoot: target,
  placeSurface: group => { panel = group; },
  send(envelope) {
    if (envelope.action) actions.push(envelope.action);
    else errors.push(envelope);
  },
  onTransportError(error) { errors.push(error.message); },
});
const surfaceId = 'matter';
const send = (type, content) => projection.receive({version: '1.0', [type]: content});
function state(revision, label) {
  send('updateDataModel', {surfaceId, value: {revision, label}});
  projection.update();
}
send('createSurface', {surfaceId, catalogId: spatialHudCatalog.id});
state(3, 'Abrir mesa');
send('updateComponents', {surfaceId, components: [
  {id: 'root', component: 'HudPanel', label: 'Manipulación de Materia', children: ['command']},
  {id: 'command', component: 'HudButton', label: {'@path': '/label'}, action: {event: {
    name: 'openTable', context: {revision: {'@path': '/revision'}},
  }}},
]});
projection.update();
renderer.fitContainer();
const frame = {
  characters: new Map(), updatedCharacterDescriptions: [], removedConnectionIds: [],
  localCharacterId: null, deltaTimeSeconds: 0, cameraTransform: camera.getCameraState(),
};
const canvas = target.querySelector(':scope > canvas');
const context = canvas.getContext('webgl2');
const pickingCamera = new PerspectiveCamera(pose.fov, pose.aspect, 0.1, 10000);
function place() {
  pickingCamera.position.set(pose.position.x, pose.position.y, pose.position.z);
  pickingCamera.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
  const {width, height} = canvas.getBoundingClientRect();
  if (placeHudInViewport) {
    placeHudInViewport(panel, pickingCamera, {width, height, pixelsPerUnit: 135, depth: 1.5});
  } else {
    pickingCamera.updateMatrixWorld();
  }
}
function sample(visible) {
  projection.group.visible = visible;
  place();
  renderer.render(frame);
  const pixels = new Uint8Array(16 * 16 * 4);
  context.readPixels(Math.floor(context.drawingBufferWidth / 2) - 8,
    Math.floor(context.drawingBufferHeight / 2) - 20, 16, 16, context.RGBA, context.UNSIGNED_BYTE, pixels);
  return pixels;
}
const background = sample(false);
const hud = sample(true);
const raycaster = new Raycaster();
let worldClicks = 0;
canvas.addEventListener('click', () => worldClicks++);
const unbind = bindSpatialHudPointer({
  element: canvas, hud: projection,
  rayForPointer(event) {
    const bounds = canvas.getBoundingClientRect();
    raycaster.setFromCamera(new Vector2(
      (event.clientX - bounds.left) / bounds.width * 2 - 1,
      1 - (event.clientY - bounds.top) / bounds.height * 2,
    ), pickingCamera);
    return {ray: raycaster.ray};
  },
});

window.hudProbe = {
  actions, errors, state,
  cameraPlacement: Boolean(placeHudInViewport),
  moveCamera() {
    pose.position.set(6, 4, -3);
    pickingCamera.position.set(pose.position.x, pose.position.y, pose.position.z);
    pickingCamera.lookAt(-3, 3, 7);
    const {x, y, z, w} = pickingCamera.quaternion;
    pose.rotation.set(x, y, z, w);
    const background = sample(false);
    return sample(true).some((channel, index) => channel !== background[index]);
  },
  meshPixelsObserved: hud.some((channel, index) => channel !== background[index]),
  sameThree: parent instanceof Group && projection.group instanceof Group && projection.group.parent === parent,
  worldClicks: () => worldClicks,
  dispose() { unbind(); projection.dispose(); renderer.dispose(); camera.dispose(); },
};
