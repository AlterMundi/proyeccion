import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {withBrowser} from '../test-support/browser.js';

const [url, installedPackage] = process.argv.slice(2);
if (!url || !installedPackage) throw new Error('Provide the loopback Weaver preview URL and the installed consumer directory.');
const lab = new URL(url);
assert.equal(lab.origin, 'http://127.0.0.1:' + lab.port);
assert.equal(lab.href, lab.origin + '/');
const consumer = resolve(installedPackage);
const {version} = JSON.parse(await readFile(join(consumer, 'node_modules/proyeccion/package.json'), 'utf8'));
const endpoint = path => new URL(path, lab);
const controls = '/api/lab/controls';
const read = async () => {
  const response = await fetch(endpoint(controls), {signal: AbortSignal.timeout(3000)});
  assert.equal(response.status, 200);
  return response.json();
};
const stateResponse = await fetch(endpoint('/api/state'), {signal: AbortSignal.timeout(3000)});
assert.equal(stateResponse.status, 200);
const state = await stateResponse.json();
assert.ok(state.session && !state.source && !state.shaper, 'Use a disposable Weaver preview without device runtime');
const initial = await read();
const direct = (current, master) => fetch(endpoint(controls), {
  method: 'POST', headers: {'Content-Type': 'application/json'}, signal: AbortSignal.timeout(3000),
  body: JSON.stringify({action: 'setMaster', session_id: current.session_id, revision: current.revision, master}),
});
const scratch = await mkdtemp(join(consumer, 'weaver-qualification-'));
const actionPath = '/api/a2ui/weaver/actions';
let restored;
try {
  await writeFile(join(scratch, 'index.html'), `<!doctype html><meta charset="utf-8">
    <title>Weaver renderer qualification</title>
    <style>
      #view {position:fixed; inset:0}
      .proyeccion-surface {width:480px; max-height:700px; overflow:auto; background:#fff; padding:12px}
    </style>
    <main id="view"></main><script type="module" src="/view.js"></script>`);
  await writeFile(join(scratch, 'view.js'), `
    import {Group, PerspectiveCamera} from 'three';
    import {createProyeccion, createHttpLiveBinding} from 'proyeccion';
    const viewport = document.querySelector('#view');
    const parent = new Group();
    const camera = new PerspectiveCamera(45, innerWidth / innerHeight, .01, 50);
    camera.position.set(0, 0, 5);
    window.receipts = [];
    window.failures = [];
    const onTransportError = error => window.failures.push(error.message);
    window.binding = createHttpLiveBinding({
      streamUrl: new URL('/api/a2ui/weaver/live', location.href.replace(/^http/, 'ws')),
      actionUrl: '/api/a2ui/weaver/actions',
      mount(send) {
        const view = createProyeccion({viewport, parent, send, onTransportError});
        view.render(camera);
        return view;
      },
      onActionReceipt: ({status}) => window.receipts.push(status),
      onTransportError,
    });
    window.binding.connect();
    window.addEventListener('pagehide', () => window.binding.dispose(), {once:true});
  `);
  const proxy = {
    name: 'weaver-preview-proxy',
    config: () => ({
      server: {fs: {allow: [consumer]}, proxy: {
        '/api/a2ui/weaver': {
          target: lab.origin, changeOrigin: true, ws: true,
          configure(proxyServer) {
            const localOrigin = (outbound, inbound) => {
              if (inbound.headers.origin === 'http://' + inbound.headers.host) {
                outbound.setHeader('origin', lab.origin);
              }
            };
            proxyServer.on('proxyReq', localOrigin);
            proxyServer.on('proxyReqWs', localOrigin);
          },
        },
      }},
    }),
  };
  await withBrowser(async (browser, origin) => {
    const scene = await browser.newPage({viewport: {width: 1050, height: 850}});
    const web = await browser.newPage({viewport: {width: 1050, height: 850}});
    for (const page of [scene, web]) page.setDefaultTimeout(6000);
    await scene.goto(origin);
    await web.goto(endpoint('/?mode=a2ui').href);
    const sceneGain = scene.getByRole('slider', {name: 'Volumen maestro'});
    const webGain = web.getByRole('slider', {name: 'Volumen maestro'});
    const apply = scene.getByRole('button', {name: 'Aplicar volumen'});
    async function both(master) {
      await Promise.all([sceneGain, webGain].map(async slider => {
        const handle = await slider.elementHandle();
        await slider.page().waitForFunction(({element, master}) => Math.abs(Number(element.value) - master) < 1e-7,
          {element: handle, master}, {timeout: 6000});
      }));
    }
    const editScene = async () => {
      await sceneGain.press('ArrowLeft');
      await apply.click();
    };
    try {
      await both(initial.master);
      const confirmed = initial.master > .40 ? .61 : .64;
      assert.equal((await direct(initial, confirmed)).status, 200);
      await both(confirmed);

      const previous = await sceneGain.elementHandle();
      await scene.evaluate(() => window.binding.connect());
      await scene.waitForFunction(element => !element.isConnected, previous);
      await both(confirmed);
      assert.deepEqual(await scene.evaluate(() => window.receipts), []);

      const beforeStale = await read();
      let releaseStale;
      const release = new Promise(resolve => { releaseStale = resolve; });
      await scene.route('**' + actionPath, async route => {
        await release;
        await route.continue();
      }, {times: 1});
      const capturedStale = scene.waitForRequest(request => request.url().endsWith(actionPath));
      const authoritative = .63;
      try {
        const [request] = await Promise.all([capturedStale, editScene()]);
        const stale = request.postDataJSON();
        assert.equal(stale.action.context.revision, beforeStale.revision);
        assert.ok(stale.action.context.sessionId === beforeStale.session_id, 'Expected a write on the preview session');
        assert.equal((await direct(beforeStale, authoritative)).status, 200);
        await both(authoritative);
      } finally {
        releaseStale();
      }
      await scene.waitForFunction(() => window.receipts.includes(409));
      assert.equal((await read()).revision, beforeStale.revision + 1);

      const beforeLost = await read();
      let lostAttempts = 0;
      let acceptedStatus;
      await scene.route('**' + actionPath, async route => {
        lostAttempts++;
        const response = await route.fetch({maxRetries: 0});
        acceptedStatus = response.status();
        await response.dispose();
        await route.abort('failed');
      });
      await editScene();
      await scene.waitForFunction(() => window.failures.length === 1);
      const committed = await read();
      assert.equal(acceptedStatus, 200);
      assert.equal(lostAttempts, 1);
      assert.equal(committed.revision, beforeLost.revision + 1);
      assert.equal(committed.master, .62);
      await both(committed.master);
      assert.deepEqual(await scene.evaluate(() => window.receipts), [409]);
      await webGain.press('ArrowRight');
      await web.getByRole('button', {name: 'Aplicar volumen'}).click();
      await both(authoritative);
      assert.equal((await read()).master, authoritative);
    } finally {
      const current = await read();
      assert.equal(current.session_id, initial.session_id);
      if (current.master !== initial.master) assert.equal((await direct(current, initial.master)).status, 200);
      await both(initial.master);
      restored = await read();
    }
  }, scratch, [proxy]);
  assert.equal(restored.master, initial.master);
  console.log(JSON.stringify({version, reconnect: 'snapshot', staleReceipt: 409, lostReceipt: 'one accepted write',
    restoredMaster: restored.master, restoredRevision: restored.revision}));
} finally {
  await rm(scratch, {recursive: true, force: true});
}
