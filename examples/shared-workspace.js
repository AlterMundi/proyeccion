import {PerspectiveCamera, Scene} from 'three';
import {createProyeccion, createSseJsonRpcBinding} from 'proyeccion';

const viewport = document.querySelector('#viewport');
const status = document.querySelector('#connection-status');
const camera = new PerspectiveCamera(42, 1, 0.01, 50);
const scene = new Scene();

const report = error => {
  status.textContent = error.message === 'The subject changed'
    ? 'The study name changed in another view. Check the current name and try again.'
    : 'The change could not be saved. Try again or reload the workbench.';
};
const projection = createProyeccion({
  parent: scene, viewport, onTransportError: report,
  async send(envelope, metadata) {
    await transport.send(envelope, metadata);
    status.textContent = '';
  },
});
const transport = createSseJsonRpcBinding(projection, {
  streamUrl: '/api/workbench/events', rpcUrl: '/api/workbench/rpc', onTransportError: report,
});

function draw() {
  const {clientWidth: width, clientHeight: height} = viewport;
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.position.set(0, 0, Math.max(3.4, 3.15 * height / width));
  camera.updateProjectionMatrix();
  projection.render(camera);
}
const observer = new ResizeObserver(draw);
observer.observe(viewport);
draw();
transport.connect();
transport.advertise().catch(report);
window.addEventListener('pagehide', () => {
  observer.disconnect();
  transport.dispose();
  projection.dispose();
}, {once: true});
