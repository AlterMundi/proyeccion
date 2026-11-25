import {spatialHudCatalog} from '../src/spatial-hud.js';
import {createWorkbench, spatialWorkbenchData, spatialWorkbenchSurface,
  workbenchData, workbenchSurface} from './workbench-model.js';

const basicCatalogId = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
const api = '/api/workbench';
const browserView = {catalogId: basicCatalogId, surface: workbenchSurface, data: workbenchData};
const tableView = {catalogId: spatialHudCatalog.id, surface: spatialWorkbenchSurface, data: spatialWorkbenchData};

function json(response, status, value) {
  response.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new Error('Expected a JSON request');
  }
  request.setEncoding('utf8');
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16384) throw new Error('Request is too large');
  }
  return JSON.parse(body);
}

export function sharedWorkbench() {
  return {
    name: 'proyeccion-shared-workbench',
    configureServer(server) {
      const model = createWorkbench();
      const {subjectRef, projectionId: surfaceId} = model.human.locate();
      const read = () => model.human.read(subjectRef);

      const send = (response, state, envelope) => {
        if (response.writableEnded) return;
        if (!response.write('id: ' + state.revision + '\nevent: a2ui\ndata: ' + JSON.stringify(envelope) + '\n\n')) {
          response.end();
        }
      };

      server.middlewares.use(async (request, response, next) => {
        const address = new URL(request.url ?? '/', 'http://localhost');
        const route = address.pathname;
        const view = address.searchParams.get('view') === 'table' ? tableView : browserView;
        const update = state => ({version: '1.0', updateDataModel: {surfaceId, value: view.data(state)}});
        if (route === api + '/events' && request.method === 'GET') {
          response.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store'});
          response.flushHeaders();
          const state = read();
          const resume = request.headers['last-event-id'];
          if (resume === undefined) send(response, state, view.surface(surfaceId, view.catalogId, state));
          else if (resume !== String(state.revision)) send(response, state, update(state));
          const unsubscribe = model.subscribe(value => send(response, value, update(value)));
          response.on('close', unsubscribe);
          return;
        }
        if (route === api + '/subject' && request.method === 'GET') {
          json(response, 200, {subjectRef, ...read()});
          return;
        }
        if (request.method !== 'POST' || (route !== api + '/subject' && route !== api + '/rpc')) return next();
        if (request.headers.origin !== undefined && request.headers.origin !== 'http://' + request.headers.host) {
          json(response, 403, {message: 'Open the local workbench to make changes.'});
          return;
        }
        let body;
        try {
          body = await readJson(request);
        } catch {
          json(response, 400, {message: 'Send a valid JSON request.'});
          return;
        }
        if (route === api + '/subject') {
          try {
            const state = model.companion.rename(body);
            json(response, 200, {subjectRef, ...state});
          } catch (error) {
            json(response, 409, {message: error.message});
          }
          return;
        }

        const id = body?.id;
        const receipt = fields => json(response, 200, {jsonrpc: '2.0', id: id ?? null, ...fields});
        const reject = (code, message) => receipt({error: {code, message}});
        if (body?.jsonrpc !== '2.0' || !Number.isSafeInteger(id)) {
          reject(-32600, 'Invalid request.');
          return;
        }
        if (body.method === 'a2ui.capabilities') {
          const catalogs = body.params?.metadata?.a2uiRendererCapabilities?.['1.0']?.supportedCatalogIds;
          if (Array.isArray(catalogs) && catalogs.includes(view.catalogId)) {
            receipt({result: null});
          } else reject(-32602, 'The renderer does not support this view’s catalog.');
          return;
        }
        const envelope = body.params?.envelope;
        if (body.method !== 'a2ui.send') {
          reject(-32601, 'Unknown method.');
        } else if (envelope?.version !== '1.0' || envelope.action?.surfaceId !== surfaceId
            || envelope.action?.name !== 'applyTitle') {
          reject(-32602, 'The action is unavailable in this workbench.');
        } else {
          try {
            const {revision, title} = envelope.action.context;
            model.human.rename({subjectRef, expectedRevision: revision, title});
            receipt({result: null});
          } catch (error) {
            reject(-32000, error.message);
          }
        }
      });
    },
  };
}

export default {plugins: [sharedWorkbench()], server: {host: '127.0.0.1'}};
