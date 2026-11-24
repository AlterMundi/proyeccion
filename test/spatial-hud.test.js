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
      function pixel(x = 161) {
        hud.update();
        renderer.setRenderTarget(buffer);
        renderer.render(scene, camera);
        const sample = new Uint8Array(4);
        renderer.readRenderTargetPixels(buffer, x, 61, 1, 1, sample);
        return [...sample];
      }
      mount('world', 'enterTable', 'Open worktable');
      const worldPixel = pixel();
      hud.setPalette({button: '#fb737c'});
      const newColor = pixel();
      const labelMap = () => scene.getObjectByName('world').getObjectByName('command').children.find(child => child.material.map).material.map;
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
      const borderBefore = pixel(167);
      const consumed = [hud.activateRay(ray)];
      const borderAfter = pixel(167);
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
      return {worldPixel, newColor, borderBefore, borderAfter, behindWorld, labelChanged, labelStable, disabledActions, consumed, actions, errors,
        groupDetached: !hud.group.parent, domHUD: document.querySelectorAll('a2ui-surface').length};
    });
    assert.deepEqual(result.errors, []);
    assert.equal(result.domHUD, 0);
    assert.ok(result.worldPixel.slice(0, 3).some(channel => channel > 0));
    assert.notDeepEqual(result.newColor, result.worldPixel);
    assert.notDeepEqual(result.borderAfter, result.borderBefore);
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

test('keyboard focus follows the active HUD and stays local across independent clients', async () => {
  await withBrowser(async (browser, origin) => {
    const clients = await Promise.all([browser.newContext(), browser.newContext()]);
    const pages = await Promise.all(clients.map(context => context.newPage()));
    await Promise.all(pages.map(async page => {
      await page.goto(origin + '/test-support/spatial-hud-host.html');
      await page.evaluate(() => {
        const {createSpatialHud, spatialHudCatalog} = window.spatialHud;
        const sent = [];
        const hud = createSpatialHud({
          parent: new window.three.Scene(), document,
          send: envelope => sent.push(envelope),
        });
        let currentSurface = 'world';
        const sentFor = action => ({event: {name: action, context: {revision: {'@path': '/revision'}}}});
        const send = (key, value) => hud.receive({version: '1.0', [key]: value});
        const state = (surfaceId, revision, disabled = false) => send('updateDataModel', {
          surfaceId, value: {revision, disabled},
        });
        function mount(surfaceId, first, second) {
          send('createSurface', {surfaceId, catalogId: spatialHudCatalog.id});
          state(surfaceId, 1);
          send('updateComponents', {surfaceId, components: [
            {id: 'root', component: 'HudPanel', children: [first, 'unavailable', second]},
            {id: first, component: 'HudButton', label: first,
              disabled: {'@path': '/disabled'}, action: sentFor(first)},
            {id: 'unavailable', component: 'HudButton', label: 'Unavailable',
              disabled: true, action: sentFor('unavailable')},
            {id: second, component: 'HudButton', label: second, action: sentFor(second)},
          ]});
        }
        mount('world', 'openTable', 'toggleSound');
        mount('app', 'inspectScene', 'closeTable');
        let movement = 0;
        document.addEventListener('keydown', event => {
          if (hud.handleKey(event, {surfaceId: currentSurface})) event.preventDefault();
        });
        document.addEventListener('keydown', event => {
          if (!event.defaultPrevented && [' ', 'w'].includes(event.key)) movement++;
        });
        window.fixture = {
          hud, sent, state, movement: () => movement,
          open() {
            this.prior = hud.currentFocus();
            currentSurface = 'app';
            hud.focusControl(currentSurface);
          },
          close() {
            send('deleteSurface', {surfaceId: 'app'});
            currentSurface = 'world';
            hud.focusControl(currentSurface, this.prior.instanceId);
          },
        };
      });
    }));
    const [first, second] = pages;
    const focus = page => page.evaluate(() => window.fixture.hud.currentFocus());
    await first.keyboard.press('Tab');
    await second.keyboard.press('Shift+Tab');
    assert.deepEqual(await focus(first), {surfaceId: 'world', instanceId: 'openTable'});
    assert.deepEqual(await focus(second), {surfaceId: 'world', instanceId: 'toggleSound'});
    await first.keyboard.press('Enter');
    await first.waitForFunction(() => window.fixture.sent.length === 1);
    await first.evaluate(() => window.fixture.open());
    assert.deepEqual(await focus(first), {surfaceId: 'app', instanceId: 'inspectScene'});
    await Promise.all(pages.map(page => page.evaluate(() => window.fixture.state('app', 8, true))));
    assert.equal(await focus(first), undefined);
    await first.keyboard.press('Tab');
    assert.deepEqual(await focus(first), {surfaceId: 'app', instanceId: 'closeTable'});
    await first.keyboard.down('Space');
    await first.keyboard.down('Space');
    await first.keyboard.up('Space');
    await first.waitForFunction(() => window.fixture.sent.length === 2);
    await first.evaluate(() => window.fixture.close());
    assert.deepEqual(await focus(first), {surfaceId: 'world', instanceId: 'openTable'});
    assert.deepEqual(await focus(second), {surfaceId: 'world', instanceId: 'toggleSound'});
    await first.keyboard.press('Escape');
    assert.equal(await focus(first), undefined);
    await first.keyboard.press('w');
    await first.keyboard.press('Space');
    const readback = await first.evaluate(() => {
      const {sent, movement} = window.fixture;
      return {actions: sent.map(({action}) => [action.name, action.surfaceId, action.context.revision]),
        movement: movement()};
    });
    assert.deepEqual(readback, {actions: [['openTable', 'world', 1], ['closeTable', 'app', 8]], movement: 2});
    assert.deepEqual(await second.evaluate(() => window.fixture.sent), []);
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('a spatial range proposes a quantized cut and displays the host confirmation', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    await page.goto(origin + '/test-support/spatial-hud-host.html');
    await page.evaluate(() => {
      const {createSpatialHud, spatialHudCatalog} = window.spatialHud;
      const {Ray, Scene, Vector3} = window.three;
      const sent = [];
      const hud = createSpatialHud({parent: new Scene(), document, send: envelope => sent.push(envelope)});
      const send = (key, value) => hud.receive({version: '1.0', [key]: value});
      const surfaceId = 'worktable';
      const state = (confirmed, revision, disabled = false) => send('updateDataModel', {
        surfaceId, value: {confirmed, revision, disabled, desired: confirmed},
      });
      send('createSurface', {surfaceId, catalogId: spatialHudCatalog.id});
      state(0.3, 5);
      send('updateComponents', {surfaceId, components: [
        {id: 'root', component: 'HudPanel', children: ['section']},
        {id: 'section', component: 'HudRange', label: 'Corte horizontal',
          min: 0, max: 1, step: 0.1, value: {'@path': '/confirmed'}, draft: {'@path': '/desired'},
          disabled: {'@path': '/disabled'},
          action: {event: {name: 'setSection', context: {
            value: {'@path': '/desired'}, revision: {'@path': '/revision'},
          }}}},
      ]});
      document.addEventListener('keydown', event => {
        if (hud.handleKey(event, {surfaceId})) event.preventDefault();
      });
      window.fixture = {
        sent, state,
        click() { return hud.activateRay(new Ray(new Vector3(0.538, -0.09, 3), new Vector3(0, 0, -1))); },
        knob() {
          hud.update();
          return hud.group.getObjectByName('section').children.find(child => child.geometry?.parameters.width === 0.035).position.x;
        },
      };
    });
    const knob = () => page.evaluate(() => window.fixture.knob());
    const read = () => page.evaluate(() => window.fixture.sent.map(({action}) => action?.context));
    const initial = await knob();
    assert.equal(await page.evaluate(() => window.fixture.click()), true);
    await page.waitForFunction(() => window.fixture.sent.length === 1);
    assert.equal(await knob(), initial);
    assert.deepEqual(await read(), [{value: 0.8, revision: 5}]);
    await page.evaluate(() => window.fixture.state(0.8, 6));
    assert.ok(await knob() > initial);
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction(() => window.fixture.sent.length === 2);
    assert.deepEqual(await read(), [{value: 0.8, revision: 5}, {value: 0.7, revision: 6}]);
    await page.evaluate(() => window.fixture.state(0.8, 7, true));
    await page.keyboard.press('End');
    assert.equal(await page.evaluate(() => window.fixture.click()), true);
    assert.equal((await read()).length, 2);
  }, process.env.PROYECCION_BROWSER_PROJECT);
});
