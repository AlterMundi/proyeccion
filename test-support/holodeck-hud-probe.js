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
const table = '/native/api/space/collection';
let collection, stream, lastShare;
let selected = null;
let panel;
const projection = createSpatialHud({
  parent, document, accessibilityRoot: target,
  placeSurface: group => { panel = group; },
  send(envelope) {
    if (!envelope.action) { errors.push(envelope); return; }
    const action = envelope.action;
    actions.push(action);
    if (action.name === 'shareModel') {
      lastShare = fetch(table, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(action.context),
      }).then(response => response.status);
    }
    if (action.name === 'chooseModel') {
      selected = action.context.resource;
      updateTable();
    }
  },
  onTransportError(error) { errors.push(error.message); },
});
const surfaceId = 'matter';
const send = (type, content) => projection.receive({version: '1.0', [type]: content});
function state(revision, label) {
  send('updateDataModel', {surfaceId, value: {revision, label}});
  projection.update();
}
function updateTable() {
  const {resource, revision, canShare} = collection.worktable;
  const title = value => collection.projects.flatMap(project => project.editions)
    .find(edition => edition.resource === value)?.title ?? 'Empty';
  send('updateDataModel', {surfaceId, value: {
    revision, resource: selected, disabled: !canShare,
    sharedLabel: 'Table: ' + title(resource), localLabel: 'Selected: ' + title(selected),
  }});
  projection.update();
  place();
  renderer.render(frame);
}
async function readTable() {
  const response = await fetch(table);
  if (!response.ok) throw Error('Collection read failed: ' + response.status);
  collection = await response.json();
  updateTable();
}
async function openNativeTable() {
  const admission = await fetch('/native/', {headers: {Accept: 'application/json'}});
  if (!admission.ok) throw Error('Admission failed: ' + admission.status);
  const entry = await fetch('/native/api/space', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({from: 'outside', to: 'matter', live: 1}),
  });
  if (!entry.ok) throw Error('Matter entry failed: ' + entry.status);
  await readTable();
  const editions = collection.projects.flatMap(project => project.editions);
  const controlId = edition => 'model_' + edition.resource;
  send('updateComponents', {surfaceId, components: [
    {id: 'root', component: 'HudPanel', label: 'Manipulación de Materia',
      children: ['shared', 'local', ...editions.map(controlId), 'command']},
    {id: 'shared', component: 'HudText', label: {'@path': '/sharedLabel'}},
    {id: 'local', component: 'HudText', label: {'@path': '/localLabel'}},
    ...editions.map(edition => ({id: controlId(edition), component: 'HudButton', label: edition.title,
      action: {event: {name: 'chooseModel', context: {resource: edition.resource}}}})),
    {id: 'command', component: 'HudButton', label: 'Share model', disabled: {'@path': '/disabled'},
      action: {event: {name: 'shareModel', context: {revision: {'@path': '/revision'}, resource: {'@path': '/resource'}}}}},
  ]});
  updateTable();
  stream = new EventSource(table + '/events');
  stream.addEventListener('refresh', () => readTable().catch(error => errors.push(error.message)));
  await new Promise((resolve, reject) => {
    stream.onopen = resolve;
    stream.onerror = () => reject(Error('Matter subscription failed'));
  });
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
  actions, errors, state, openNativeTable, lastShare: () => lastShare,
  nativeRevision: () => collection?.worktable.revision,
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
  dispose() { stream?.close(); unbind(); projection.dispose(); renderer.dispose(); camera.dispose(); },
};
