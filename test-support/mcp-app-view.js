import {App} from '@modelcontextprotocol/ext-apps';
import {PerspectiveCamera, Scene} from 'three';
import {createMcpTransportBinding, createProyeccion} from 'proyeccion';

const viewport = document.querySelector('#viewport');
const status = document.querySelector('#status');
const reportFailure = error => { status.textContent = error.message; };
const app = new App({name: 'proyeccion-mcp-app-example', version: '1.0.0'}, {}, {autoResize: false});
const view = createProyeccion({
  parent: new Scene(), viewport, onTransportError: reportFailure,
  send: (envelope, metadata) => binding.send(envelope, metadata),
});
const binding = createMcpTransportBinding(view, {
  client: {callTool: params => app.callServerTool(params)}, onTransportError: reportFailure,
});
const camera = new PerspectiveCamera(42, viewport.clientWidth / viewport.clientHeight, 0.01, 40);
camera.position.z = 5;
view.render(camera);
app.ontoolresult = result => binding.receiveToolResult(result);
app.onteardown = async () => { view.dispose(); return {}; };
app.connect().catch(reportFailure);
