import {PerspectiveCamera, Scene} from 'three';
import {createProyeccion, createSseJsonRpcBinding} from 'proyeccion';

const viewport = document.querySelector('#viewport');
const status = document.querySelector('#connection-status');
const table = new URLSearchParams(location.search).get('view') === 'table';

const report = error => {
  status.textContent = error.message === 'The subject changed'
    ? 'The study name changed in another view. Check the current name and try again.'
    : 'The change could not be saved. Try again or reload the workbench.';
};
async function send(envelope, metadata) {
  await transport.send(envelope, metadata);
  status.textContent = '';
}

function mountBrowserWorkbench() {
  const camera = new PerspectiveCamera(42, 1, 0.01, 50);
  const projection = createProyeccion({parent: new Scene(), viewport, onTransportError: report, send});
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
  return {projection, dispose() {
    observer.disconnect();
    projection.dispose();
  }};
}

const view = table
  ? (await import('./table-workbench.js')).mountTableWorkbench(viewport, (envelope, metadata) => {
      send(envelope, metadata).catch(report);
    })
  : mountBrowserWorkbench();
const profile = table ? '?view=table' : '';
const transport = createSseJsonRpcBinding(view.projection, {
  streamUrl: '/api/workbench/events' + profile, rpcUrl: '/api/workbench/rpc' + profile, onTransportError: report,
});
transport.connect();
transport.advertise().catch(report);
window.addEventListener('pagehide', () => {
  transport.dispose();
  view.dispose();
}, {once: true});
