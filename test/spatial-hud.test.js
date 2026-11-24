import assert from 'node:assert/strict';
import test from 'node:test';
import {withBrowser} from '../test-support/browser.js';

test('WebGL world and app surfaces dispatch authoritative A2UI actions', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    await page.goto(origin + '/test-support/spatial-hud-host.html');
    const result = await page.evaluate(async () => {
      const {createSpatialHud, spatialHudCatalog} = window.spatialHud;
      const {three} = window;
      const {OrthographicCamera, Ray, Scene, Vector3, WebGLRenderer, WebGLRenderTarget} = three;
      const scene = new Scene();
      const camera = new OrthographicCamera(-1, 1, 0.2, -0.6, 0.1, 10);
      camera.position.z = 3;
      const renderer = new WebGLRenderer();
      const buffer = new WebGLRenderTarget(192, 96);
      const actions = [];
      const errors = [];
      const hud = createSpatialHud({
        parent: scene, document, send: envelope => {
          if (envelope.action) actions.push(envelope.action);
          else errors.push(envelope);
        }, onTransportError: error => errors.push(error.message),
        placeSurface: (group, id) => { group.position.z = id === 'app' ? 0.5 : 0; },
      });
      const message = (name, body) => hud.receive({version: '1.0', [name]: body});
      function mount(surfaceId, action, label, disabled = false) {
        message('createSurface', {surfaceId, catalogId: spatialHudCatalog.id});
        message('updateDataModel', {surfaceId, value: {label, disabled, revision: 1}});
        message('updateComponents', {surfaceId, components: [
          {id: 'root', component: 'HudPanel', children: ['command']},
          {id: 'command', component: 'HudButton', label: {'@path': '/label'},
            disabled: {'@path': '/disabled'},
            action: {event: {name: action, context: {revision: {'@path': '/revision'}}}}},
        ]});
      }
      const ray = new Ray(new Vector3(0.71, -0.09, 3), new Vector3(0, 0, -1));
      const turn = () => new Promise(resolve => setTimeout(resolve, 0));
      function pixel() {
        hud.update();
        renderer.setRenderTarget(buffer);
        renderer.render(scene, camera);
        const sample = new Uint8Array(4);
        renderer.readRenderTargetPixels(buffer, 161, 61, 1, 1, sample);
        return [...sample];
      }
      mount('world', 'enterTable', 'Open worktable');
      const worldPixel = pixel();
      hud.setPalette({button: '#fb737c'});
      const newColor = pixel();
      const labelMap = () => scene.getObjectByName('world').getObjectByName('command').children[1].material.map;
      const initialLabel = labelMap();
      let labelDisposed = false;
      initialLabel.addEventListener('dispose', () => { labelDisposed = true; });
      message('updateDataModel', {surfaceId: 'world', value: {label: 'Inspect worktable', disabled: false, revision: 2}});
      await turn();
      hud.update();
      const labelChanged = initialLabel !== labelMap() && labelDisposed;
      const stableLabel = labelMap();
      hud.update();
      const labelStable = stableLabel === labelMap();
      const behindWorld = hud.activateRay(ray, {maxDistance: 1});
      const consumed = [hud.activateRay(ray)];
      await turn();
      mount('app', 'leaveTable', 'Leave worktable', true);
      consumed.push(hud.activateRay(ray));
      await turn();
      const disabledActions = actions.length;
      message('updateDataModel', {surfaceId: 'app', value: {label: 'Leave worktable', disabled: false, revision: 3}});
      await turn();
      consumed.push(hud.activateRay(ray));
      await turn();
      message('deleteSurface', {surfaceId: 'app'});
      consumed.push(hud.activateRay(ray));
      await turn();
      hud.dispose();
      buffer.dispose();
      renderer.dispose();
      return {worldPixel, newColor, behindWorld, labelChanged, labelStable, disabledActions, consumed, actions, errors,
        groupDetached: !hud.group.parent, domHUD: document.querySelectorAll('a2ui-surface').length};
    });
    assert.deepEqual(result.errors, []);
    assert.equal(result.domHUD, 0);
    assert.ok(result.worldPixel.slice(0, 3).some(channel => channel > 0));
    assert.notDeepEqual(result.newColor, result.worldPixel);
    assert.equal(result.labelChanged, true);
    assert.equal(result.labelStable, true);
    assert.equal(result.behindWorld, false);
    assert.equal(result.disabledActions, 1);
    assert.deepEqual(result.consumed, [true, true, true, true]);
    assert.deepEqual(result.actions.map(({name, sourceComponentId, surfaceId, context}) =>
      [name, sourceComponentId, surfaceId, context.revision]), [
      ['enterTable', 'command', 'world', 2],
      ['leaveTable', 'command', 'app', 3],
      ['enterTable', 'command', 'world', 2],
    ]);
    assert.equal(result.groupDetached, true);
  }, process.env.PROYECCION_BROWSER_PROJECT);
});
