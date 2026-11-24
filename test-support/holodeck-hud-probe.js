import {CameraManager, CollisionsManager} from '@mml-io/3d-web-client-core';
import {ThreeJSWorldRenderer} from '@mml-io/3d-web-threejs';
import {Group, Ray, Vector3} from 'three';
import {createSpatialHud, spatialHudCatalog} from 'proyeccion/spatial-hud';

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
const projection = createSpatialHud({
  parent, document, accessibilityRoot: target,
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
const context = target.querySelector(':scope > canvas').getContext('webgl2');
function sample(visible) {
  projection.group.visible = visible;
  renderer.render(frame);
  const pixels = new Uint8Array(16 * 16 * 4);
  context.readPixels(Math.floor(context.drawingBufferWidth / 2) - 8,
    Math.floor(context.drawingBufferHeight / 2) - 22, 16, 16, context.RGBA, context.UNSIGNED_BYTE, pixels);
  return pixels;
}
const background = sample(false);
const hud = sample(true);

window.hudProbe = {
  actions, errors, state,
  meshPixelsObserved: hud.some((channel, index) => channel !== background[index]),
  sameThree: parent instanceof Group && projection.group instanceof Group && projection.group.parent === parent,
  ray: () => projection.activateRay(new Ray(new Vector3(0, -0.09, 3), new Vector3(0, 0, -1))),
  dispose() { projection.dispose(); renderer.dispose(); camera.dispose(); },
};
