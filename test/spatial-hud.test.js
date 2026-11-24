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

test('a paged spatial selector keeps pending selection local and commits only an enabled option', async () => {
  await withBrowser(async (browser, origin) => {
    const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
    const pages = await Promise.all(contexts.map(context => context.newPage()));
    await Promise.all(pages.map(async page => {
      await page.goto(origin + '/test-support/spatial-hud-host.html');
      await page.evaluate(() => {
        const {createSpatialHud, placeHudInViewport, spatialHudCatalog} = window.spatialHud;
        const {OrthographicCamera, Ray, Scene, Vector3} = window.three;
        const actions = [];
        const hud = createSpatialHud({parent: new Scene(), document, send: envelope => actions.push(envelope.action)});
        const send = (name, body) => hud.receive({version: '1.0', [name]: body});
        const surfaceId = 'matter';
        const options = Array.from({length: 13}, (_, index) => ({
          id: 'part-' + index, label: 'Pieza ' + index, disabled: index === 1 || index === 12,
        }));
        const state = (confirmed, revision) => send('updateDataModel', {
          surfaceId, value: {confirmed, revision, draft: confirmed, options},
        });
        send('createSurface', {surfaceId, catalogId: spatialHudCatalog.id});
        state('part-0', 2);
        send('updateComponents', {surfaceId, components: [
          {id: 'root', component: 'HudPanel', children: ['part']},
          {id: 'part', component: 'HudChoice', label: 'Pieza', options: {'@path': '/options'},
            value: {'@path': '/confirmed'}, draft: {'@path': '/draft'}, action: {event: {
              name: 'choosePart', context: {part: {'@path': '/draft'}, revision: {'@path': '/revision'}},
            }}},
        ]});
        document.addEventListener('keydown', event => {
          if (hud.handleKey(event, {surfaceId})) event.preventDefault();
        });
        window.fixture = {
          actions, state,
          click(y) {
            return hud.activateRay(new Ray(new Vector3(0, y, 3), new Vector3(0, 0, -1)));
          },
          menuLength() {
            hud.update();
            return hud.group.getObjectByName('hud-choice-options')?.children.length ?? 0;
          },
          bounds() {
            hud.update();
            return hud.getSurfaceBounds(surfaceId);
          },
          fitMenu() {
            hud.update();
            const panel = hud.group.getObjectByName(surfaceId);
            const {top, bottom} = hud.getSurfaceBounds(surfaceId);
            const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
            camera.position.z = 3;
            const height = 390;
            const pixelsPerUnit = (height - 124) / (top - bottom);
            placeHudInViewport(panel, camera, {width: 820, height, y: 54 + top * pixelsPerUnit, pixelsPerUnit});
            return panel.getObjectByName('hud-choice-options').children.map(cell =>
              (1 - cell.getWorldPosition(new Vector3()).project(camera).y) * height / 2);
          },
          labelTexture() {
            hud.update();
            return hud.group.getObjectByName('part').children.find(child => child.material?.map).material.map.uuid;
          },
        };
      });
    }));
    const [first, second] = pages;
    const menuLength = page => page.evaluate(() => window.fixture.menuLength());
    const label = page => page.evaluate(() => window.fixture.labelTexture());
    const click = (page, y) => page.evaluate(y => window.fixture.click(y), y);
    const initial = await Promise.all(pages.map(label));
    const bounds = page => page.evaluate(() => window.fixture.bounds());
    const closedBounds = await bounds(first);
    // Pointer opens the first page, consumes a click on a disabled option and pages down.
    assert.equal(await click(first, -0.09), true);
    assert.equal(await menuLength(first), 6);
    assert.equal(await menuLength(second), 0);
    assert.ok((await bounds(first)).bottom < closedBounds.bottom);
    assert.deepEqual(await bounds(second), closedBounds);
    assert.equal(await click(first, -0.45), true);
    assert.equal(await menuLength(first), 6);
    assert.equal(await click(first, -1.17), true);
    assert.equal(await menuLength(first), 7);
    await first.keyboard.press('End');
    await first.keyboard.press('Enter');
    await first.waitForFunction(() => window.fixture.actions.length === 1);
    assert.equal(await menuLength(first), 0);
    assert.deepEqual(await Promise.all(pages.map(label)), initial);
    assert.deepEqual(await first.evaluate(() => window.fixture.actions.map(action => action.context)),
      [{part: 'part-11', revision: 2}]);
    // A separate visitor can keep inspecting the menu while confirmed state arrives.
    await second.keyboard.press('Tab');
    await second.keyboard.press('Space');
    await second.keyboard.press('ArrowDown');
    await Promise.all(pages.map(page => page.evaluate(() => window.fixture.state('part-11', 3))));
    assert.equal(await menuLength(second), 6);
    const confirmed = await Promise.all(pages.map(label));
    assert.ok(confirmed.every((uuid, index) => uuid !== initial[index]));
    await second.keyboard.press('Enter');
    await second.waitForFunction(() => window.fixture.actions.length === 1);
    assert.deepEqual(await second.evaluate(() => window.fixture.actions.map(action => action.context)),
      [{part: 'part-2', revision: 3}]);
    // The pointer can directly select an option on the current page.
    assert.equal(await click(first, -0.09), true);
    assert.equal(await menuLength(first), 4);
    assert.equal(await click(first, -0.45), true);
    await first.waitForFunction(() => window.fixture.actions.length === 2);
    assert.deepEqual(await first.evaluate(() => window.fixture.actions.at(-1).context), {part: 'part-10', revision: 3});
    assert.deepEqual(await bounds(first), closedBounds);
    assert.equal(await click(first, -0.09), true);
    const fitted = await first.evaluate(() => window.fixture.fitMenu());
    assert.equal(fitted.length, 4);
    assert.ok(fitted.every(y => y >= 54 && y <= 320));
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('native text composition edits a mesh field locally until keyboard or spatial submission', async () => {
  await withBrowser(async (browser, origin) => {
    const first = await browser.newPage();
    const second = await browser.newPage();
    await Promise.all([first, second].map(async page => {
      await page.goto(origin + '/test-support/spatial-hud-host.html');
      await page.evaluate(() => {
        const {createSpatialHud, spatialHudCatalog} = window.spatialHud;
        const {Ray, Scene, Vector3} = window.three;
        const output = [];
        const hud = createSpatialHud({parent: new Scene(), document, send: envelope => output.push(envelope)});
        const surfaceId = 'conversation';
        const send = (name, body) => hud.receive({version: '1.0', [name]: body});
        const state = (revision, text = '', disabled = false) => send('updateDataModel', {
          surfaceId, value: {revision, text, draft: text, disabled},
        });
        send('createSurface', {surfaceId, catalogId: spatialHudCatalog.id, sendDataModel: true});
        state(1);
        const action = {event: {name: 'sendMessage', context: {
          message: {'@path': '/draft'}, revision: {'@path': '/revision'},
        }}};
        send('updateComponents', {surfaceId, components: [
          {id: 'root', component: 'HudPanel', children: ['compose', 'send']},
          {id: 'compose', component: 'HudTextInput', label: 'Mensaje', placeholder: 'Escribí desde acá',
            multiline: true, maxLength: 80, value: {'@path': '/text'}, draft: {'@path': '/draft'},
            disabled: {'@path': '/disabled'}, action},
          {id: 'send', component: 'HudButton', label: 'Enviar', submitFor: 'compose', action},
        ]});
        document.addEventListener('keydown', event => {
          if (!hud.ownsTextInput(event.target) && hud.handleKey(event, {surfaceId})) event.preventDefault();
        });
        window.fixture = {
          hud, output, state,
          click(y) {
            return hud.activateRay(new Ray(new Vector3(0, y, 3), new Vector3(0, 0, -1)));
          },
          texture() {
            hud.update();
            return hud.group.getObjectByName('compose').children.find(child => child.material?.map).material.map.uuid;
          },
          remove() { send('deleteSurface', {surfaceId}); },
        };
      });
    }));
    const texture = page => page.evaluate(() => window.fixture.texture());
    const [beforeFirst, beforeSecond] = await Promise.all([first, second].map(texture));
    await first.keyboard.press('Tab');
    await first.keyboard.press('Enter');
    const native = first.getByRole('textbox', {name: 'Mensaje'});
    await native.waitFor({state: 'attached'});
    await first.keyboard.insertText('Desde acá');
    await first.keyboard.press('Enter');
    await first.keyboard.insertText('ま');
    await native.dispatchEvent('compositionstart');
    await first.keyboard.press('Control+Enter');
    assert.equal(await native.inputValue(), 'Desde acá\nま');
    assert.deepEqual(await first.evaluate(() => window.fixture.output), []);
    assert.notEqual(await texture(first), beforeFirst);
    assert.equal(await texture(second), beforeSecond);
    assert.equal(await first.evaluate(() => window.fixture.hud.synchronizedDataModel().surfaces.conversation.draft), '');
    await native.dispatchEvent('compositionend');
    await first.evaluate(() => window.fixture.state(2));
    await first.keyboard.press('Control+Enter');
    await first.waitForFunction(() => window.fixture.output.length === 1);
    assert.equal(await native.count(), 0);
    assert.deepEqual(await first.evaluate(() => window.fixture.output[0].action.context),
      {message: 'Desde acá\nま', revision: 2});
    assert.deepEqual(await second.evaluate(() => window.fixture.output), []);

    await first.evaluate(() => window.fixture.state(3));
    assert.equal(await first.evaluate(() => window.fixture.click(-0.17)), true);
    await first.keyboard.insertText('Envío con el botón');
    assert.equal(await first.evaluate(() => window.fixture.click(-0.43)), true);
    await first.waitForFunction(() => window.fixture.output.length === 2);
    assert.deepEqual(await first.evaluate(() => window.fixture.output[1].action.context),
      {message: 'Envío con el botón', revision: 3});
    await first.evaluate(() => window.fixture.click(-0.17));
    await first.keyboard.insertText('Descartar');
    await first.keyboard.press('Escape');
    await first.evaluate(() => window.fixture.click(-0.43));
    assert.equal(await first.evaluate(() => window.fixture.output.length), 2);
    await first.evaluate(() => window.fixture.click(-0.17));
    await first.evaluate(() => window.fixture.remove());
    assert.equal(await native.count(), 0);
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('nested HUD layout reflows when the host changes visible controls and preserves action order', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    await page.goto(origin + '/test-support/spatial-hud-host.html');
    await page.evaluate(() => {
      const {createSpatialHud, spatialHudCatalog} = window.spatialHud;
      const {Ray, Scene, Vector3} = window.three;
      const actions = [];
      const hud = createSpatialHud({parent: new Scene(), document, send: envelope => actions.push(envelope.action)});
      const surfaceId = 'world';
      const send = (name, body) => hud.receive({version: '1.0', [name]: body});
      const state = (show, revision) => send('updateDataModel', {surfaceId, value: {show, revision}});
      const button = (id, props = {}) => ({
        id, component: 'HudButton', label: id, action: {event: {
          name: id, context: {revision: {'@path': '/revision'}},
        }}, ...props,
      });
      send('createSurface', {surfaceId, catalogId: spatialHudCatalog.id});
      state(true, 1);
      send('updateComponents', {surfaceId, components: [
        {id: 'root', component: 'HudPanel', width: 3.2, gap: 0.06, children: ['title', 'tools', 'exit']},
        {id: 'title', component: 'HudText', label: 'Manipulación de Materia'},
        {id: 'tools', component: 'HudRow', gap: 0.08, children: ['travel', 'appearance']},
        {id: 'travel', component: 'HudColumn', weight: 2, children: ['map', 'markedExit']},
        button('map'),
        button('markedExit', {visible: {'@path': '/show'}}),
        button('appearance'),
        button('exit'),
      ]});
      document.addEventListener('keydown', event => {
        if (hud.handleKey(event, {surfaceId})) event.preventDefault();
      });
      window.fixture = {
        actions, state, focus: () => hud.currentFocus()?.instanceId,
        box(id) {
          hud.update();
          const row = hud.group.getObjectByName(id);
          return row && {x: row.position.x, y: row.position.y, scale: row.scale.x};
        },
        select(id) {
          hud.update();
          const row = hud.group.getObjectByName(id);
          return hud.activateRay(new Ray(new Vector3(row.position.x, row.position.y, 3), new Vector3(0, 0, -1)));
        },
      };
    });
    const box = id => page.evaluate(id => window.fixture.box(id), id);
    const focus = () => page.evaluate(() => window.fixture.focus());
    const [map, marked, appearance, priorExit] = await Promise.all(['map', 'markedExit', 'appearance', 'exit'].map(box));
    assert.ok(map.x < 0 && appearance.x > 0);
    assert.equal(map.y, appearance.y);
    assert.equal(map.x, marked.x);
    assert.equal(map.scale, appearance.scale * 2);
    assert.ok(marked.y < map.y);
    await page.keyboard.press('Tab');
    assert.equal(await focus(), 'map');
    await page.keyboard.press('Tab');
    assert.equal(await focus(), 'markedExit');
    await page.evaluate(() => window.fixture.state(false, 2));
    assert.equal(await box('markedExit'), undefined);
    assert.equal(await focus(), undefined);
    const exit = await box('exit');
    assert.ok(Math.abs(exit.y - priorExit.y - 0.18) < 1e-10);
    assert.equal(await page.evaluate(() => window.fixture.select('appearance')), true);
    await page.waitForFunction(() => window.fixture.actions.length === 1);
    assert.equal(await focus(), 'appearance');
    await page.keyboard.press('Tab');
    assert.equal(await focus(), 'exit');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.fixture.actions.length === 2);
    assert.deepEqual(await page.evaluate(() => window.fixture.actions.map(({name, context}) =>
      [name, context.revision])), [['appearance', 2], ['exit', 2]]);
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('spatial navigation draws room markers and each visitor’s position and bearing', async () => {
  await withBrowser(async (browser, origin) => {
    const pages = await Promise.all([browser.newPage(), browser.newPage()]);
    await Promise.all(pages.map(async page => {
      await page.goto(origin + '/test-support/spatial-hud-host.html');
      await page.evaluate(() => {
        const {createSpatialHud, spatialHudCatalog} = window.spatialHud;
        const {Ray, Scene, Vector3} = window.three;
        const actions = [];
        const hud = createSpatialHud({parent: new Scene(), document, send: envelope => actions.push(envelope.action)});
        const surfaceId = 'travel';
        const pose = {'@path': '/viewer'};
        const send = (name, body) => hud.receive({version: '1.0', [name]: body});
        const state = (viewer, selected, revision) => send('updateDataModel', {
          surfaceId, value: {
            viewer, selected, revision,
            marks: [
              {id: 'stair', x: -3, z: 2, kind: 'stair'},
              {id: 'garden', x: 3, z: -3, kind: 'outside'},
            ],
            guide: Boolean(selected), title: 'Salida al jardín', distance: '4 m', direction: Math.PI / 2,
          },
        });
        send('createSurface', {surfaceId, catalogId: spatialHudCatalog.id});
        state(null, '', 1);
        send('updateComponents', {surfaceId, components: [
          {id: 'root', component: 'HudPanel', children: ['map', 'direction', 'clear']},
          {id: 'map', component: 'HudMap', marks: {'@path': '/marks'}, viewer: pose, selected: {'@path': '/selected'}},
          {id: 'direction', component: 'HudBearing', label: {'@path': '/title'}, distance: {'@path': '/distance'},
            heading: {'@path': '/direction'}, visible: {'@path': '/guide'}},
          {id: 'clear', component: 'HudButton', label: 'Quitar salida marcada', visible: {'@path': '/guide'},
            action: {event: {name: 'clearExit', context: {revision: {'@path': '/revision'}}}}},
        ]});
        const readObject = object => object && {
          id: object.uuid, x: object.position.x, y: object.position.y,
          heading: object.rotation.z, visible: object.visible, scale: object.scale.x,
          color: object.material?.color.getHexString(),
        };
        window.fixture = {
          hud, actions, state,
          read() {
            hud.update();
            const find = name => hud.group.getObjectByName(name);
            return {viewer: readObject(find('hud-map-viewer')), garden: readObject(find('hud-map-mark:garden')),
              stair: readObject(find('hud-map-mark:stair')), guide: readObject(find('hud-bearing-pointer'))};
          },
          clear() {
            return hud.activateRay(new Ray(new Vector3(0, -1.13, 3), new Vector3(0, 0, -1)));
          },
        };
      });
    }));
    const [first, second] = pages;
    const read = page => page.evaluate(() => window.fixture.read());
    assert.equal((await read(first)).viewer.visible, false);
    await first.evaluate(() => window.fixture.state({x: 1, z: -2, heading: Math.PI / 2}, 'garden', 4));
    await second.evaluate(() => window.fixture.state({x: -2, z: 3, heading: 0}, '', 4));
    const [a, b] = await Promise.all(pages.map(read));
    assert.ok(a.viewer.x > 0 && a.viewer.y > 0 && a.viewer.heading === 0);
    assert.ok(b.viewer.x < 0 && b.viewer.y < 0 && b.viewer.heading === Math.PI / 2);
    assert.ok(a.stair.x < 0 && a.stair.y < 0);
    assert.equal(a.garden.scale, 1.35);
    assert.equal(b.garden.scale, 1);
    assert.equal(a.guide.heading, 0);
    assert.equal(b.guide, undefined);
    await first.evaluate(() => {
      window.fixture.hud.setPalette({focus: '#aa77cc'});
      window.fixture.state({x: 20, z: -20, heading: Math.PI}, 'garden', 5);
    });
    const moved = await read(first);
    assert.equal(moved.viewer.id, a.viewer.id);
    assert.ok(moved.viewer.x > a.viewer.x && moved.viewer.x < 0.385);
    assert.equal(moved.garden.color, 'aa77cc');
    assert.equal(moved.guide.color, 'aa77cc');
    assert.equal(await first.evaluate(() => window.fixture.clear()), true);
    await first.waitForFunction(() => window.fixture.actions.length === 1);
    assert.deepEqual(await first.evaluate(() => window.fixture.actions.map(action => action.context)), [{revision: 5}]);
    assert.deepEqual(await second.evaluate(() => window.fixture.actions), []);
    await first.evaluate(() => window.fixture.state(null, '', 6));
    assert.equal((await read(first)).guide, undefined);
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('dragging a range keeps a preview local and releases one action or cancels on host change', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage({hasTouch: true});
    await page.goto(origin + '/test-support/spatial-hud-host.html');
    await page.evaluate(() => {
      const {createSpatialHud, spatialHudCatalog} = window.spatialHud;
      const {OrthographicCamera, Raycaster, Scene, Vector2, WebGLRenderer} = window.three;
      const scene = new Scene();
      const camera = new OrthographicCamera(-1, 1, 0.3, -0.5, 0.1, 10);
      camera.position.z = 3;
      camera.updateMatrixWorld();
      const gl = new WebGLRenderer();
      gl.setSize(600, 240);
      const canvas = gl.domElement;
      canvas.style.touchAction = 'none';
      document.body.append(canvas);
      const actions = [];
      const hud = createSpatialHud({parent: scene, document, send: envelope => actions.push(envelope.action)});
      const raycaster = new Raycaster();
      const surfaceId = 'worktable';
      const send = (name, body) => hud.receive({version: '1.0', [name]: body});
      const state = (value, revision) => send('updateDataModel', {
        surfaceId, value: {value, proposal: value, revision},
      });
      const cut = name => ({id: 'cut', component: 'HudRange', label: 'Corte', min: 0, max: 1, step: 0.1,
        value: {'@path': '/value'}, draft: {'@path': '/proposal'},
        action: {event: {name, context: {value: {'@path': '/proposal'}, revision: {'@path': '/revision'}}}}});
      send('createSurface', {surfaceId, catalogId: spatialHudCatalog.id});
      state(0.3, 1);
      send('updateComponents', {surfaceId, components: [
        {id: 'root', component: 'HudPanel', children: ['cut']},
        cut('cutAt'),
      ]});
      let captured;
      let worldClicks = 0;
      const ray = ({clientX, clientY}) => {
        const bounds = canvas.getBoundingClientRect();
        raycaster.setFromCamera(new Vector2(
          (clientX - bounds.left) / bounds.width * 2 - 1, 1 - (clientY - bounds.top) / bounds.height * 2,
        ), camera);
        return raycaster.ray;
      };
      canvas.onpointerdown = event => {
        if (hud.beginRangeDrag(ray(event))) {
          captured = event.pointerId;
          canvas.setPointerCapture(captured);
        }
      };
      canvas.onpointermove = event => {
        if (event.pointerId === captured) hud.moveRangeDrag(ray(event));
      };
      canvas.onpointerup = event => {
        if (event.pointerId !== captured) {
          ++worldClicks;
          return;
        }
        captured = undefined;
        hud.endRangeDrag(ray(event));
      };
      canvas.onpointercancel = () => {
        captured = undefined;
        hud.cancelRangeDrag();
      };
      window.fixture = {
        state, actions, worldClicks: () => worldClicks,
        replaceAction() { send('updateComponents', {surfaceId, components: [cut('cutOtherModel')]}); },
        read() {
          hud.update();
          gl.render(scene, camera);
          const cut = hud.group.getObjectByName('cut');
          const preview = cut.getObjectByName('hud-range-preview');
          const knob = cut.children.find(child => child.geometry?.parameters.width === 0.035);
          return {visible: preview.visible, preview: preview.position.x, confirmed: knob.position.x};
        },
      };
    });
    const canvas = await page.locator('canvas').boundingBox();
    const point = x => ({x: canvas.x + (x + 1) * canvas.width / 2, y: canvas.y + canvas.height * 0.488});
    const move = async x => { const target = point(x); await page.mouse.move(target.x, target.y); };
    const read = () => page.evaluate(() => window.fixture.read());
    const actions = () => page.evaluate(() => window.fixture.actions.map(({context}) => context));
    const initial = await read();
    await move(0.18);
    await page.mouse.down();
    await move(0.59);
    const pending = await read();
    assert.equal(pending.visible, true);
    assert.equal(pending.confirmed, initial.confirmed);
    assert.ok(pending.preview > pending.confirmed);
    assert.deepEqual(await actions(), []);
    await page.mouse.up();
    await page.waitForFunction(() => window.fixture.actions.length === 1);
    assert.deepEqual(await actions(), [{value: 0.9, revision: 1}]);
    assert.equal((await read()).visible, false);
    assert.equal((await read()).confirmed, initial.confirmed);
    await page.evaluate(() => window.fixture.state(0.9, 2));
    assert.equal((await read()).confirmed, pending.preview);

    await move(0.59);
    await page.mouse.down();
    await move(0.24);
    assert.equal((await read()).visible, true);
    await page.evaluate(() => window.fixture.state(0.7, 3));
    assert.equal((await read()).visible, false);
    await page.mouse.up();
    assert.equal((await actions()).length, 1);
    assert.equal(await page.evaluate(() => window.fixture.worldClicks()), 0);

    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', {
      type, touchPoints: x === undefined ? [] : [point(x)],
    });
    await touch('touchStart', 0.48);
    await touch('touchMove', 0.30);
    assert.equal((await read()).visible, true);
    await touch('touchCancel');
    assert.equal((await read()).visible, false);
    assert.equal((await actions()).length, 1);
    await touch('touchStart', 0.48);
    await touch('touchMove', 0.38);
    await touch('touchEnd');
    await page.waitForFunction(() => window.fixture.actions.length === 2);
    assert.deepEqual(await actions(), [{value: 0.9, revision: 1}, {value: 0.5, revision: 3}]);
    await move(0.48);
    await page.mouse.down();
    assert.equal((await read()).visible, true);
    await page.evaluate(() => window.fixture.replaceAction());
    assert.equal((await read()).visible, false);
    await page.mouse.up();
    assert.equal((await actions()).length, 2);
    assert.equal(await page.evaluate(() => window.fixture.worldClicks()), 0);
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('host-selected modal input scope leaves the world visible and blocks underlying actions', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    await page.goto(origin + '/test-support/spatial-hud-host.html');
    await page.evaluate(() => {
      const {createSpatialHud, spatialHudCatalog} = window.spatialHud;
      const {Ray, Scene, Vector3} = window.three;
      const actions = [];
      const hud = createSpatialHud({
        parent: new Scene(), document, send: envelope => actions.push(envelope.action.name),
        placeSurface: (group, id) => { group.position.x = ({world: -2, activity: 0, sound: 2})[id]; },
      });
      const send = (name, body) => hud.receive({version: '1.0', [name]: body});
      function surface(surfaceId, summary) {
        send('createSurface', {surfaceId, catalogId: spatialHudCatalog.id});
        send('updateComponents', {surfaceId, components: [
          {id: 'root', component: 'HudPanel', children: summary ? ['summary', 'button'] : ['button']},
          ...(summary ? [{id: 'summary', component: 'HudText', label: summary, style: 'status', lines: 3}] : []),
          {id: 'button', component: 'HudButton', label: surfaceId, action: {event: {name: surfaceId}}},
        ]});
      }
      surface('world');
      surface('sound');
      hud.focusControl('world', 'button');
      window.fixture = {
        hud, actions,
        inWorld: hud.currentFocus(),
        showActivity() {
          surface('activity', 'El jardín cambió.\nUna luz fue agregada cerca de la entrada.\nDos visitantes vieron el cambio.');
          hud.focusControl('activity', 'button');
        },
        worldVisible: () => hud.group.getObjectByName('world').visible,
        pressAt(x, y = -0.09) {
          return hud.activateRay(new Ray(new Vector3(x, y, 3), new Vector3(0, 0, -1)));
        },
        summaryRows() {
          hud.update();
          const {image} = hud.group.getObjectByName('summary').children[0].material.map;
          const context = image.getContext('2d');
          return [0, 1, 2].map(row => {
            const height = Math.floor(image.height / 3);
            return context.getImageData(0, height * row, image.width, height).data
              .some((channel, index) => index % 4 === 3 && channel > 0);
          });
        },
      };
    });
    const pressAt = (x, y) => page.evaluate(([x, y]) => window.fixture.pressAt(x, y), [x, y]);
    await page.evaluate(() => window.fixture.hud.setInteractionScope({surfaceIds: ['activity', 'sound'], blockOutside: true}));
    assert.equal(await pressAt(-2), true);
    assert.equal(await page.evaluate(() => window.fixture.hud.focusControl('world')), false);
    await page.evaluate(() => window.fixture.showActivity());
    assert.equal(await page.evaluate(() => window.fixture.worldVisible()), true);
    assert.deepEqual(await page.evaluate(() => window.fixture.summaryRows()), [true, true, true]);
    assert.equal(await pressAt(-2), true);
    assert.equal(await pressAt(0, -0.4), true);
    assert.equal(await pressAt(2), true);
    await page.waitForFunction(() => window.fixture.actions.length === 2);
    assert.deepEqual(await page.evaluate(() => window.fixture.actions), ['activity', 'sound']);
    await page.evaluate(() => {
      const {hud, inWorld} = window.fixture;
      hud.receive({version: '1.0', deleteSurface: {surfaceId: 'activity'}});
      hud.setInteractionScope();
      hud.focusControl(inWorld.surfaceId, inWorld.instanceId);
    });
    assert.equal(await pressAt(0, -0.4), false);
    assert.deepEqual(await page.evaluate(() => window.fixture.hud.currentFocus()), {surfaceId: 'world', instanceId: 'button'});
    assert.equal(await pressAt(-2), true);
    await page.waitForFunction(() => window.fixture.actions.length === 3);
    assert.deepEqual(await page.evaluate(() => window.fixture.actions), ['activity', 'sound', 'world']);
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('the accessible HUD exposes native roles and shares scene actions and modal ownership', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    await page.goto(origin + '/test-support/spatial-hud-host.html');
    await page.evaluate(() => {
      const {createSpatialHud, spatialHudCatalog} = window.spatialHud;
      const actions = [];
      const hud = createSpatialHud({
        parent: new window.three.Scene(), document, accessibilityRoot: document.body,
        send: envelope => actions.push(envelope.action),
      });
      const send = (type, content) => hud.receive({version: '1.0', [type]: content});
      const action = (name, fields = {}) => ({event: {
        name, context: {revision: {'@path': '/revision'}, ...fields},
      }});
      const state = (revision, level, part) => send('updateDataModel', {
        surfaceId: 'matter', value: {
          revision, level, part, text: '', levelDraft: level, partDraft: part, textDraft: '',
          options: [{id: 'a', label: 'Ala'}, {id: 'b', label: 'Fuselaje'}, {id: 'c', label: 'Motor', disabled: true}],
          status: 'Mesa lista',
        },
      });
      for (const surfaceId of ['world', 'matter']) send('createSurface', {surfaceId, catalogId: spatialHudCatalog.id});
      state(7, 0.3, 'a');
      send('updateDataModel', {surfaceId: 'world', value: {revision: 8}});
      send('updateComponents', {surfaceId: 'world', components: [
        {id: 'root', component: 'HudPanel', label: 'Mundo', children: ['enter']},
        {id: 'enter', component: 'HudButton', label: 'Abrir mesa', action: action('enter')},
      ]});
      send('updateComponents', {surfaceId: 'matter', components: [
        {id: 'root', component: 'HudPanel', label: 'Mesa', children: ['status', 'sound', 'cut', 'part', 'search']},
        {id: 'status', component: 'HudText', style: 'status', label: {'@path': '/status'}},
        {id: 'sound', component: 'HudButton', label: 'Sonido', pressed: true, action: action('sound')},
        {id: 'cut', component: 'HudRange', label: 'Corte horizontal', min: 0, max: 1, step: 0.1,
          value: {'@path': '/level'}, draft: {'@path': '/levelDraft'},
          action: action('setCut', {level: {'@path': '/levelDraft'}})},
        {id: 'part', component: 'HudChoice', label: 'Pieza', options: {'@path': '/options'},
          value: {'@path': '/part'}, draft: {'@path': '/partDraft'},
          action: action('setPart', {part: {'@path': '/partDraft'}})},
        {id: 'search', component: 'HudTextInput', label: 'Buscar proyecto', value: {'@path': '/text'},
          draft: {'@path': '/textDraft'}, action: action('search', {text: {'@path': '/textDraft'}})},
      ]});
      hud.update();
      document.addEventListener('keydown', event => {
        if (!hud.ownsAccessibleInput(event.target) && !hud.ownsTextInput(event.target)
            && hud.handleKey(event, {surfaceId: 'matter'})) event.preventDefault();
      });
      window.fixture = {hud, actions, state};
    });
    const world = page.getByRole('group', {name: 'Mundo'});
    const table = page.getByRole('group', {name: 'Mesa'});
    assert.equal(await world.getByRole('button', {name: 'Abrir mesa'}).count(), 1);
    assert.equal(await table.getByRole('status').textContent(), 'Mesa lista');
    const sound = table.getByRole('button', {name: 'Sonido', pressed: true});
    await sound.focus();
    await page.keyboard.press('Enter');
    const range = table.getByRole('slider', {name: 'Corte horizontal'});
    assert.equal(await range.inputValue(), '0.3');
    await range.focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.fixture.actions.length === 2);
    assert.equal(await range.inputValue(), '0.3');
    await page.evaluate(() => { window.fixture.state(8, 0.4, 'a'); window.fixture.hud.update(); });
    assert.equal(await range.inputValue(), '0.4');
    const part = table.getByRole('combobox', {name: 'Pieza'});
    assert.equal(await part.getByRole('option', {name: 'Motor'}).isDisabled(), true);
    await part.selectOption('b', {force: true});
    await page.waitForFunction(() => window.fixture.actions.length === 3);
    assert.equal(await part.inputValue(), 'a');
    await table.getByRole('button', {name: 'Buscar proyecto'}).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('textbox', {name: 'Buscar proyecto'}).waitFor({state: 'attached'});
    await page.keyboard.insertText('viga');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.fixture.actions.length === 4);
    assert.deepEqual(await page.evaluate(() => window.fixture.actions.map(({name, context}) => [name, context])), [
      ['sound', {revision: 7}], ['setCut', {level: 0.4, revision: 7}],
      ['setPart', {part: 'b', revision: 8}], ['search', {text: 'viga', revision: 8}],
    ]);
    await page.evaluate(() => window.fixture.hud.setInteractionScope({surfaceIds: ['matter'], blockOutside: true}));
    assert.equal(await world.count(), 0);
    await page.evaluate(() => window.fixture.hud.setInteractionScope());
    assert.equal(await page.evaluate(() => window.fixture.hud.focusAccessibleControl('world', 'enter')), true);
    assert.equal(await world.getByRole('button', {name: 'Abrir mesa'}).evaluate(el =>
      el === document.activeElement), true);
    await page.evaluate(() => window.fixture.hud.dispose());
    assert.equal(await page.locator('[data-spatial-hud-accessibility]').count(), 0);
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('the canvas pointer binding routes each native gesture to the HUD or world once', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage({hasTouch: true});
    await page.goto(origin + '/test-support/spatial-hud-host.html');
    await page.evaluate(() => {
      const {bindSpatialHudPointer, createSpatialHud, spatialHudCatalog} = window.spatialHud;
      const {OrthographicCamera, Raycaster, Scene, Vector2} = window.three;
      const canvas = document.createElement('canvas');
      canvas.width = 600;
      canvas.height = 240;
      canvas.style.touchAction = 'none';
      document.body.append(canvas);
      const camera = new OrthographicCamera(-1, 1, 0.3, -0.5, 0.1, 10);
      camera.position.z = 3;
      camera.updateMatrixWorld();
      const caster = new Raycaster();
      const actions = [];
      const hud = createSpatialHud({parent: new Scene(), document, send: envelope => actions.push(envelope.action)});
      const surfaceId = 'worktable';
      const send = (key, value) => hud.receive({version: '1.0', [key]: value});
      const command = (name, label = {'@path': '/label'}) => ({id: 'command', component: 'HudButton',
        label, disabled: {'@path': '/disabled'}, action: {event: {name}}});
      function create(name) {
        send('createSurface', {surfaceId, catalogId: spatialHudCatalog.id});
        send('updateDataModel', {surfaceId, value: {label: 'Mesa', section: 0.3, draft: 0.3, disabled: false}});
        send('updateComponents', {surfaceId, components: [
          {id: 'root', component: 'HudPanel', children: ['command', 'section']},
          command(name),
          {id: 'section', component: 'HudRange', label: 'Corte', min: 0, max: 1, step: 0.1,
            value: {'@path': '/section'}, draft: {'@path': '/draft'},
            action: {event: {name: 'setSection', context: {value: {'@path': '/draft'}}}}},
        ]});
      }
      create('open');
      let worldClicks = 0;
      let worldDown = 0;
      let maxDistance = Infinity;
      canvas.addEventListener('pointerdown', () => worldDown++);
      canvas.addEventListener('click', () => worldClicks++);
      const unbind = bindSpatialHudPointer({
        element: canvas, hud,
        rayForPointer(event) {
          const bounds = canvas.getBoundingClientRect();
          caster.setFromCamera(new Vector2(
            (event.clientX - bounds.left) / bounds.width * 2 - 1,
            1 - (event.clientY - bounds.top) / bounds.height * 2,
          ), camera);
          return {ray: caster.ray, maxDistance};
        },
      });
      window.fixture = {
        hud, actions, unbind,
        world: () => ({down: worldDown, clicks: worldClicks}),
        remount() { send('deleteSurface', {surfaceId}); create('reopened'); },
        replaceAction(name) { send('updateComponents', {surfaceId, components: [command(name)]}); },
        relabel(label) { send('updateDataModel', {surfaceId, path: '/label', value: label}); },
        wall(value) { maxDistance = value; },
        disabled(value) { send('updateDataModel', {surfaceId, path: '/disabled', value}); },
      };
    });
    const canvas = await page.locator('canvas').boundingBox();
    const point = (x, y = -0.09) => [
      canvas.x + (x + 1) * canvas.width / 2,
      canvas.y + (0.3 - y) * canvas.height / 0.8,
    ];
    const world = () => page.evaluate(() => window.fixture.world());
    const actions = () => page.evaluate(() => window.fixture.actions.map(({name, context}) => [name, context]));
    await page.mouse.click(...point(0));
    await page.waitForFunction(() => window.fixture.actions.length === 1);
    assert.deepEqual(await world(), {down: 0, clicks: 0});
    await page.mouse.click(...point(0.94));
    assert.deepEqual(await world(), {down: 1, clicks: 1});
    await page.mouse.move(...point(0));
    await page.mouse.down();
    await page.mouse.move(...point(0.4));
    await page.mouse.up();
    assert.deepEqual(await world(), {down: 1, clicks: 1});
    assert.deepEqual(await actions(), [['open', {}]]);
    await page.mouse.move(...point(0));
    await page.mouse.down();
    await page.evaluate(() => window.fixture.remount());
    await page.mouse.up();
    assert.deepEqual(await actions(), [['open', {}]]);
    await page.evaluate(() => window.fixture.disabled(true));
    await page.mouse.move(...point(0));
    await page.mouse.down();
    await page.evaluate(() => window.fixture.disabled(false));
    await page.mouse.up();
    assert.deepEqual(await actions(), [['open', {}]]);
    await page.mouse.down();
    await page.evaluate(() => window.fixture.replaceAction('visit'));
    await page.mouse.up();
    assert.deepEqual(await actions(), [['open', {}]]);
    await page.mouse.down();
    await page.evaluate(() => window.fixture.relabel('Visitar galería'));
    await page.mouse.up();
    assert.deepEqual(await actions(), [['open', {}]]);
    await page.touchscreen.tap(...point(0));
    await page.waitForFunction(() => window.fixture.actions.length === 2);
    assert.deepEqual(await world(), {down: 1, clicks: 1});
    await page.mouse.move(...point(0.20, -0.27));
    await page.mouse.down();
    await page.mouse.move(...point(0.54, -0.27));
    await page.mouse.up();
    await page.waitForFunction(() => window.fixture.actions.length === 3);
    assert.deepEqual(await actions(), [['open', {}], ['visit', {}], ['setSection', {value: 0.8}]]);
    await page.evaluate(() => window.fixture.wall(1));
    await page.mouse.click(...point(0));
    assert.deepEqual(await world(), {down: 2, clicks: 2});
    await page.evaluate(() => window.fixture.hud.setInteractionScope({surfaceIds: [], blockOutside: true}));
    await page.mouse.click(...point(0.94));
    assert.deepEqual(await world(), {down: 2, clicks: 2});
    await page.evaluate(() => window.fixture.unbind());
    await page.mouse.click(...point(0));
    assert.deepEqual(await world(), {down: 3, clicks: 3});
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('a native HUD gesture can invoke the host’s browser-owned fullscreen action', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    await page.goto(origin + '/test-support/spatial-hud-host.html');
    await page.evaluate(() => {
      const {bindSpatialHudPointer, createSpatialHud, spatialHudCatalog} = window.spatialHud;
      const {Ray, Scene, Vector3} = window.three;
      const canvas = document.createElement('canvas');
      document.body.append(canvas);
      const result = [];
      const surfaceId = 'world';
      const hud = createSpatialHud({
        parent: new Scene(), document, accessibilityRoot: document.body,
        send({action}) {
          if (action?.name !== 'toggleFullscreen' || action.surfaceId !== surfaceId
              || action.sourceComponentId !== 'fullscreen') return;
          const active = navigator.userActivation.isActive;
          const request = document.fullscreenElement ? document.exitFullscreen()
            : document.documentElement.requestFullscreen();
          return request.then(() => {
            const pressed = Boolean(document.fullscreenElement);
            update(pressed);
            result.push({active, pressed});
          });
        },
      });
      function update(pressed) {
        hud.receive({version: '1.0', updateComponents: {surfaceId, components: [
          {id: 'root', component: 'HudPanel', children: ['fullscreen']},
          {id: 'fullscreen', component: 'HudButton', label: pressed ? 'Salir de pantalla completa' : 'Pantalla completa',
            pressed, action: {event: {name: 'toggleFullscreen'}}},
        ]}});
        hud.update();
      }
      hud.receive({version: '1.0', createSurface: {surfaceId, catalogId: spatialHudCatalog.id}});
      update(false);
      bindSpatialHudPointer({
        element: canvas, hud, rayForPointer: () => ({ray: new Ray(new Vector3(0, -0.09, 3), new Vector3(0, 0, -1))}),
      });
      window.fixture = {result};
    });
    await page.locator('canvas').click();
    await page.waitForFunction(() => window.fixture.result.length === 1);
    assert.deepEqual(await page.evaluate(() => window.fixture.result), [{active: true, pressed: true}]);
    assert.equal(await page.getByRole('button', {name: 'Salir de pantalla completa', pressed: true}).count(), 1);
    await page.locator('canvas').click();
    await page.waitForFunction(() => window.fixture.result.length === 2);
    assert.deepEqual(await page.evaluate(() => window.fixture.result.at(-1)), {active: true, pressed: false});
    assert.equal(await page.getByRole('button', {name: 'Pantalla completa', pressed: false}).count(), 1);
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('spatial movement, jump and shared HUD actions have independent touch inputs', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage({hasTouch: true});
    await page.goto(origin + '/test-support/spatial-hud-host.html');
    await page.evaluate(() => {
      const {bindSpatialHudPointer, createSpatialHud, spatialHudCatalog} = window.spatialHud;
      const {OrthographicCamera, Raycaster, Scene, Vector2} = window.three;
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 350;
      canvas.style.touchAction = 'none';
      document.body.append(canvas);
      const camera = new OrthographicCamera(-1.1, 1.1, 0.18, -1.15, 0.1, 10);
      camera.position.z = 3;
      camera.updateMatrixWorld();
      const caster = new Raycaster();
      const actions = [];
      const hud = createSpatialHud({
        parent: new Scene(), document, accessibilityRoot: document.body,
        send: envelope => actions.push(envelope),
        placeSurface(group, id) { if (id === 'sound') group.position.y = -0.8; },
      });
      const surfaceId = 'movement';
      const send = (type, content) => hud.receive({version: '1.0', [type]: content});
      send('createSurface', {surfaceId, catalogId: spatialHudCatalog.id});
      send('updateComponents', {surfaceId, components: [
        {id: 'root', component: 'HudPanel', width: 1.8, label: 'Movimiento', children: ['row']},
        {id: 'row', component: 'HudRow', children: ['stick', 'jump']},
        {id: 'stick', component: 'HudStick', label: 'Moverse'},
        {id: 'jump', component: 'HudJump', label: 'Saltar'},
      ]});
      send('createSurface', {surfaceId: 'sound', catalogId: spatialHudCatalog.id});
      send('updateComponents', {surfaceId: 'sound', components: [
        {id: 'root', component: 'HudPanel', children: ['sound']},
        {id: 'sound', component: 'HudButton', label: 'Sonido', action: {event: {name: 'toggleSound'}}},
      ]});
      bindSpatialHudPointer({
        element: canvas, hud,
        rayForPointer(event) {
          const rect = canvas.getBoundingClientRect();
          caster.setFromCamera(new Vector2(
            (event.clientX - rect.left) / rect.width * 2 - 1,
            1 - (event.clientY - rect.top) / rect.height * 2,
          ), camera);
          return {ray: caster.ray};
        },
      });
      let worldDown = 0;
      canvas.addEventListener('pointerdown', () => worldDown++);
      hud.update();
      window.fixture = {
        hud, actions, worldDown: () => worldDown,
        read() {
          const stick = hud.group.getObjectByName('stick').getObjectByName('hud-locomotion-indicator');
          const jump = hud.group.getObjectByName('jump').getObjectByName('hud-locomotion-indicator');
          return {input: hud.locomotionInput.getOutput(), stickY: stick.position.y, jump: jump.visible};
        },
      };
    });
    const box = await page.locator('canvas').boundingBox();
    const at = (id, x, y) => ({id,
      x: box.x + (x + 1.1) * box.width / 2.2, y: box.y + (0.18 - y) * box.height / 1.33,
    });
    const session = await page.context().newCDPSession(page);
    const touch = (type, ...touchPoints) => session.send('Input.dispatchTouchEvent', {type, touchPoints});
    const read = () => page.evaluate(() => window.fixture.read());
    const center = at(1, -0.46, -0.32);
    const forward = at(1, -0.46, -0.09);
    const side = at(1, -0.20, -0.32);
    const jump = at(2, 0.46, -0.25);
    await touch('touchStart', center);
    await touch('touchMove', forward);
    await page.waitForFunction(() => window.fixture.read().input?.isSprinting === true);
    const walking = await read();
    assert.ok(Math.abs(Math.abs(walking.input.direction) - Math.PI) < 0.02);
    assert.ok(walking.stickY > 0);
    assert.equal(walking.input.jump, false);
    await touch('touchStart', forward, jump);
    await page.waitForFunction(() => window.fixture.read().input?.jump === true);
    await touch('touchMove', side, jump);
    await page.waitForFunction(() => Math.abs(window.fixture.read().input?.direction - Math.PI / 2) < 0.02);
    assert.equal((await read()).jump, true);
    await page.evaluate(() => window.fixture.hud.setInteractionScope({surfaceIds: [], blockOutside: true}));
    assert.deepEqual(await read(), {input: null, stickY: 0, jump: false});
    await touch('touchEnd');
    assert.deepEqual(await read(), {input: null, stickY: 0, jump: false});
    await page.evaluate(() => window.fixture.hud.setInteractionScope());
    await touch('touchStart', center);
    await touch('touchMove', forward);
    await touch('touchStart', forward, at(3, 0, -0.89));
    assert.equal((await read()).input.isSprinting, true);
    await touch('touchEnd');
    assert.equal((await read()).input, null);
    const sharedActions = await page.evaluate(() => window.fixture.actions.map(({action}) => action.name));
    assert.deepEqual(sharedActions, ['toggleSound']);
    await page.getByRole('button', {name: 'Saltar'}).focus();
    await page.keyboard.press('Enter');
    assert.deepEqual((await read()).input, {direction: null, isSprinting: false, jump: true});
    assert.equal((await read()).input, null);
    assert.equal(await page.evaluate(() => window.fixture.worldDown()), 0);
    assert.equal(await page.evaluate(() => window.fixture.actions.length), 1);
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('camera-relative HUD placement keeps visual size and ray targets across camera and viewport changes', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    await page.goto(origin + '/test-support/spatial-hud-host.html');
    const checks = await page.evaluate(async () => {
      const {createSpatialHud, placeHudInViewport, spatialHudCatalog} = window.spatialHud;
      const {Group, OrthographicCamera, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3} = window.three;
      const parent = new Group();
      new Scene().add(parent);
      parent.position.set(-5, 3, 9);
      parent.rotation.set(0.1, -0.7, 0.3);
      parent.scale.set(2, 0.6, 1.8);
      let panel;
      const actions = [];
      const hud = createSpatialHud({
        parent, document, send: envelope => actions.push(envelope.action),
        placeSurface: group => { panel = group; },
      });
      const surfaceId = 'world';
      hud.receive({version: '1.0', createSurface: {surfaceId, catalogId: spatialHudCatalog.id}});
      hud.receive({version: '1.0', updateComponents: {surfaceId, components: [
        {id: 'root', component: 'HudPanel', children: ['action']},
        {id: 'action', component: 'HudButton', label: 'Abrir mesa', action: {event: {name: 'openTable'}}},
      ]}});
      hud.update();
      const raycaster = new Raycaster();
      function check(camera, width, height) {
        const x = width * 0.42;
        const y = height * 0.19;
        const pixelsPerUnit = 135;
        placeHudInViewport(panel, camera, {width, height, x, y, pixelsPerUnit, depth: 1.5});
        const screen = (x, y) => {
          const point = panel.localToWorld(new Vector3(x, y, 0)).project(camera);
          return [(point.x + 1) * width / 2, (1 - point.y) * height / 2];
        };
        const top = screen(0, 0);
        const right = screen(1, 0);
        const bottom = screen(0, -1);
        const button = screen(0, -0.09);
        raycaster.setFromCamera(new Vector2(button[0] / width * 2 - 1, 1 - button[1] / height * 2), camera);
        return {x: top[0] - x, y: top[1] - y, width: right[0] - top[0],
          height: bottom[1] - top[1], active: hud.activateRay(raycaster.ray)};
      }
      const desktop = new PerspectiveCamera(65, 1280 / 720, 0.1, 200);
      desktop.position.set(70, -10, 18);
      desktop.lookAt(5, 2, -7);
      const mobile = new PerspectiveCamera(54, 420 / 800, 0.1, 200);
      mobile.position.set(-12, 7, -23);
      mobile.lookAt(5, 9, 12);
      const mapCamera = new OrthographicCamera(-7, 7, 5, -5, 0.1, 50);
      mapCamera.position.set(-4, 12, 8);
      mapCamera.lookAt(0, 0, 0);
      const measurements = [check(desktop, 1280, 720), check(mobile, 420, 800), check(mapCamera, 700, 500)];
      await new Promise(resolve => setTimeout(resolve, 0));
      return {measurements, actions: actions.map(action => action.name)};
    });
    for (const measurement of checks.measurements) {
      assert.ok(Math.abs(measurement.x) < 0.001 && Math.abs(measurement.y) < 0.001);
      assert.ok(Math.abs(measurement.width - 135) < 0.001 && Math.abs(measurement.height - 135) < 0.001);
      assert.equal(measurement.active, true);
    }
    assert.deepEqual(checks.actions, ['openTable', 'openTable', 'openTable']);
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('Holodeck room palettes preserve mesh transparency and each visitor’s focus', async () => {
  await withBrowser(async (browser, origin) => {
    const pages = await Promise.all([browser.newPage(), browser.newPage()]);
    await Promise.all(pages.map(async page => {
      await page.goto(origin + '/test-support/spatial-hud-host.html');
      await page.evaluate(() => {
        const {createSpatialHud, spatialHudCatalog} = window.spatialHud;
        const {OrthographicCamera, Ray, Scene, Vector3, WebGLRenderer, WebGLRenderTarget} = window.three;
        const scene = new Scene();
        const camera = new OrthographicCamera(-1, 1, 0.22, -0.36, 0.1, 10);
        const renderer = new WebGLRenderer();
        const target = new WebGLRenderTarget(100, 100);
        camera.position.z = 3;
        const actions = [];
        const hud = createSpatialHud({parent: scene, document, send: envelope => actions.push(envelope.action)});
        const surfaceId = 'matter';
        const send = (type, content) => hud.receive({version: '1.0', [type]: content});
        send('createSurface', {surfaceId, catalogId: spatialHudCatalog.id});
        send('updateDataModel', {surfaceId, value: {revision: 14}});
        send('updateComponents', {surfaceId, components: [
          {id: 'root', component: 'HudPanel', children: ['share']},
          {id: 'share', component: 'HudButton', label: 'Compartir', action: {event: {
            name: 'shareTable', context: {revision: {'@path': '/revision'}},
          }}},
        ]});
        hud.focusControl(surfaceId, 'share');
        window.fixture = {
          hud, actions,
          read() {
            hud.update();
            const group = hud.group.getObjectByName(surfaceId);
            const plate = group.children.find(item => item.isMesh);
            const button = group.getObjectByName('share').children.find(item => item.geometry?.parameters.depth === 0.048);
            const {material} = plate;
            renderer.setRenderTarget(target);
            renderer.render(scene, camera);
            const rgba = new Uint8Array(4);
            renderer.readRenderTargetPixels(target, 88, 47, 1, 1, rgba);
            return {color: material.color.getHexString(), alpha: material.opacity, transparent: material.transparent,
              sample: [...rgba], button: button.uuid, focus: hud.currentFocus()?.instanceId};
          },
          share() { return hud.activateRay(new Ray(new Vector3(0, -0.09, 3), new Vector3(0, 0, -1))); },
        };
      });
    }));
    const [first, second] = pages;
    const read = page => page.evaluate(() => window.fixture.read());
    const palette = (page, colors) => page.evaluate(colors => window.fixture.hud.setPalette(colors), colors);
    const initial = await read(first);
    await palette(first, {background: '#1b2d3bea', button: '#152634', focus: '#f2c38f', text: '#f1f4f7'});
    await palette(second, {background: '#412a24ed', button: '#30201d', focus: '#ffd297', text: '#fff2df'});
    const [orbital, amber] = await Promise.all(pages.map(read));
    assert.deepEqual([orbital.color, orbital.alpha, orbital.transparent], ['1b2d3b', 234 / 255, true]);
    assert.deepEqual([amber.color, amber.alpha, amber.transparent], ['412a24', 237 / 255, true]);
    assert.notDeepEqual(orbital.sample, amber.sample);
    assert.equal(orbital.button, initial.button);
    assert.equal(orbital.focus, 'share');
    await palette(first, {background: '#234f'});
    const opaque = await read(first);
    assert.deepEqual([opaque.color, opaque.alpha, opaque.transparent], ['223344', 1, false]);
    assert.deepEqual(await read(second), amber);
    assert.equal(await first.evaluate(() => window.fixture.share()), true);
    await first.waitForFunction(() => window.fixture.actions.length === 1);
    assert.deepEqual(await first.evaluate(() => window.fixture.actions[0].context), {revision: 14});
    assert.deepEqual(await second.evaluate(() => window.fixture.actions), []);
  }, process.env.PROYECCION_BROWSER_PROJECT);
});
