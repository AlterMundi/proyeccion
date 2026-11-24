import {PerspectiveCamera, Scene} from 'three';
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
window.fixture = {projection, outbound, failures};
