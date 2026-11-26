import assert from 'node:assert/strict';
import test from 'node:test';
import {withBrowser} from '../test-support/browser.js';

test('host transition bounds follow the rendered and raycast control through viewport changes', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    await page.goto(origin + '/test-support/spatial-hud-host.html');
    const result = await page.evaluate(async () => {
      const {createSpatialHud, placeHudInViewport, spatialHudCatalog} = window.spatialHud;
      const {Group, Matrix4, PerspectiveCamera, Raycaster, Scene, Vector2, WebGLRenderer, WebGLRenderTarget} = window.three;
      const scene = new Scene();
      const parent = new Group();
      parent.rotation.y = 0.27;
      parent.position.set(0.2, -0.1, 0.8);
      parent.scale.set(1.1, 0.9, 1);
      scene.add(parent);
      const camera = new PerspectiveCamera(52, 1, 0.1, 20);
      camera.position.set(0.3, 0.2, 3);
      camera.lookAt(0, 0, 0);
      const renderer = new WebGLRenderer();
      renderer.setClearColor(0);
      const actions = [];
      const hud = createSpatialHud({parent, document, send: envelope => actions.push(envelope.action)});
      hud.setPalette({button: '#ff0000', background: '#000000', text: '#ffffff'});
      const surfaceId = 'dock';
      const receive = (kind, data) => hud.receive({version: '1.0', [kind]: {surfaceId, ...data}});
      const value = (visible, disabled) => receive('updateDataModel', {value: {visible, disabled}});
      receive('createSurface', {catalogId: spatialHudCatalog.id});
      value(true, false);
      receive('updateComponents', {components: [
        {id: 'root', component: 'HudPanel', children: ['talk']},
        {id: 'talk', component: 'HudButton', label: 'Conversar', visible: {'@path': '/visible'},
          disabled: {'@path': '/disabled'}, action: {event: {name: 'talk'}}},
      ]});
      const panel = hud.group.getObjectByName(surfaceId);
      const cases = [];
      const turn = () => new Promise(resolve => setTimeout(resolve, 0));
      for (const [width, height, backingScale, tilt] of [[400, 260, 1.5, 0], [310, 410, 2, 0.29]]) {
        const viewport = {left: 11, top: 23, width, height};
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        hud.setTextDensity(surfaceId, {cssPixelsPerUnit: 145, pixelRatio: backingScale});
        hud.update();
        placeHudInViewport(panel, camera, {width, height, y: height * 0.42, pixelsPerUnit: 145, depth: 1});
        panel.matrix.multiply(new Matrix4().makeRotationY(tilt));
        panel.matrixWorldNeedsUpdate = true;
        const bounds = hud.getControlViewportBounds(surfaceId, 'talk', camera, viewport);
        const pw = width * backingScale, ph = height * backingScale;
        const buffer = new WebGLRenderTarget(pw, ph);
        renderer.setRenderTarget(buffer);
        renderer.render(scene, camera);
        const bytes = new Uint8Array(pw * ph * 4);
        renderer.readRenderTargetPixels(buffer, 0, 0, pw, ph, bytes);
        let left = pw, right = -1, bottom = ph, top = -1;
        for (let y = 0; y < ph; y++) {
          for (let x = 0; x < pw; x++) {
            const offset = (y * pw + x) * 4;
            if (bytes[offset] > 160 && bytes[offset + 1] < 48 && bytes[offset + 2] < 48) {
              left = Math.min(left, x);
              right = Math.max(right, x);
              bottom = Math.min(bottom, y);
              top = Math.max(top, y);
            }
          }
        }
        buffer.dispose();
        const pixels = [viewport.left + left / backingScale, viewport.top + (ph - top - 1) / backingScale,
          viewport.left + (right + 1) / backingScale, viewport.top + (ph - bottom) / backingScale];
        const projected = [bounds.left, bounds.top, bounds.left + bounds.width, bounds.top + bounds.height];
        const error = Math.max(...projected.map((edge, i) => Math.abs(edge - pixels[i])));
        const ray = new Raycaster();
        ray.setFromCamera(new Vector2(
          (bounds.left - viewport.left + bounds.width / 2) / width * 2 - 1,
          1 - (bounds.top - viewport.top + bounds.height / 2) / height * 2), camera);
        const consumed = hud.activateRay(ray.ray);
        hud.clearFocus();
        await turn();
        cases.push({error, consumed});
      }
      const viewport = {width: 310, height: 410};
      const before = hud.getControlViewportBounds(surfaceId, 'talk', camera, viewport);
      value(true, true);
      await turn();
      hud.update();
      const disabled = hud.getControlViewportBounds(surfaceId, 'talk', camera, viewport);
      value(false, false);
      await turn();
      hud.update();
      const hidden = hud.getControlViewportBounds(surfaceId, 'talk', camera, viewport);
      receive('deleteSurface', {});
      const removed = hud.getControlViewportBounds(surfaceId, 'talk', camera, viewport);
      hud.dispose();
      renderer.dispose();
      return {cases, before, disabled, hidden, removed, actions: actions.map(action => action.name)};
    });
    for (const {error, consumed} of result.cases) {
      assert.ok(error <= 1, `Projected control missed the rendered edge by ${error} CSS pixels`);
      assert.equal(consumed, true);
    }
    assert.deepEqual(result.actions, ['talk', 'talk']);
    assert.deepEqual(result.disabled, result.before);
    assert.equal(result.hidden, undefined);
    assert.equal(result.removed, undefined);
  });
});

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

test('optical controls paint role, focus and disabled states while preserving the revisioned hit', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error' && /shader|WebGLProgram/i.test(message.text())) errors.push(message.text());
    });
    await page.goto(origin + '/test-support/spatial-hud-host.html');
    const result = await page.evaluate(async () => {
      const {createSpatialHud, spatialHudCatalog} = window.spatialHud;
      const {OrthographicCamera, Ray, Scene, Vector3, WebGLRenderer, WebGLRenderTarget} = window.three;
      const parent = new Scene();
      const camera = new OrthographicCamera(-1.4, 1.4, 0.2, -0.6, 0.1, 10);
      camera.position.z = 3;
      const renderer = new WebGLRenderer({alpha: true});
      const buffer = new WebGLRenderTarget(320, 144);
      const accessibilityRoot = document.body.appendChild(document.createElement('div'));
      const actions = [];
      let role = 'primary';
      const hud = createSpatialHud({parent, document, accessibilityRoot,
        controlStyle: 'optical', controlRole: () => role,
        send: ({action}) => actions.push([action.name, action.context.revision]),
      });
      hud.setPalette({background: '#00000000', button: '#243846', pressed: '#685234',
        disabled: '#242529', focus: '#8ff569'});
      const send = (type, fields) => hud.receive({version: '1.0', [type]: {surfaceId: 'map', ...fields}});
      send('createSurface', {catalogId: spatialHudCatalog.id});
      send('updateComponents', {components: [
        {id: 'root', component: 'HudPanel', children: ['command']},
        {id: 'command', component: 'HudButton', label: {'@path': '/label'}, icon: {'@path': '/icon'},
          disabled: {'@path': '/disabled'}, pressed: {'@path': '/pressed'},
          action: {event: {name: 'open', context: {revision: {'@path': '/revision'}}}}},
      ]});
      const update = (revision, pressed = false, disabled = false, icon = 'map', label = 'Minimapa') =>
        send('updateDataModel', {value: {revision, pressed, disabled, icon, label}});
      const frame = () => {
        hud.update();
        renderer.setRenderTarget(buffer);
        renderer.render(parent, camera);
        const bytes = new Uint8Array(320 * 144 * 4);
        renderer.readRenderTargetPixels(buffer, 0, 0, 320, 144, bytes);
        let accent = 0;
        for (let i = 0; i < bytes.length; i += 4) {
          if (bytes[i + 1] > bytes[i] + 20 && bytes[i + 1] > bytes[i + 2] + 25) accent++;
        }
        return {accent, bytes};
      };
      update(3);
      const primary = frame();
      const target = parent.getObjectByName('command');
      const center = target.getWorldPosition(new Vector3());
      const ray = new Ray(new Vector3(center.x + 0.35, center.y, 3), new Vector3(0, 0, -1));
      const consumed = hud.activateRay(ray);
      await new Promise(resolve => setTimeout(resolve, 0));
      const focused = frame();
      role = 'navigation';
      update(4, true);
      const active = frame();
      update(5, false, true);
      const disabled = frame();
      hud.activateRay(ray);
      await new Promise(resolve => setTimeout(resolve, 0));
      const button = accessibilityRoot.querySelector('button');
      const mapLabel = button.getAttribute('aria-label');
      update(6, false, false, 'play', 'Reproducir');
      frame();
      button.focus();
      const play = frame();
      update(7, false, false, 'pause', 'Reproducir');
      const pause = frame();
      update(8, false, false, 'constructor', 'Reproducir');
      const plain = frame();
      update(9, false, false, 'pause', 'Pausar');
      frame();
      const keptFocus = button === document.activeElement;
      button.click();
      await new Promise(resolve => setTimeout(resolve, 0));
      const compared = {
        visible: primary.bytes.some((channel, index) => index % 4 === 3 && channel > 40),
        focusChangesPixels: focused.accent > primary.accent,
        activeChangesPixels: active.bytes.some((channel, i) => channel !== focused.bytes[i]),
        disabledChangesPixels: disabled.bytes.some((channel, i) => channel !== active.bytes[i]),
        playPauseChangesPixels: pause.bytes.some((channel, i) => channel !== play.bytes[i]),
        missingIconChangesPixels: plain.bytes.some((channel, i) => channel !== pause.bytes[i]),
        keptFocus, consumed, actions, mapLabel, playbackLabel: button.getAttribute('aria-label'),
      };
      hud.dispose();
      buffer.dispose();
      renderer.dispose();
      return compared;
    });
    assert.deepEqual(errors, []);
    assert.equal(result.mapLabel, 'Minimapa');
    assert.equal(result.playbackLabel, 'Pausar');
    assert.equal(result.keptFocus, true);
    assert.equal(result.playPauseChangesPixels, true);
    assert.equal(result.missingIconChangesPixels, true);
    assert.equal(result.visible, true);
    assert.equal(result.focusChangesPixels, true);
    assert.equal(result.activeChangesPixels, true);
    assert.equal(result.disabledChangesPixels, true);
    assert.equal(result.consumed, true);
    assert.deepEqual(result.actions, [['open', 3], ['open', 9]]);
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('a 360 px icon dock keeps text alternatives, focus and the touch action on reflow', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage({hasTouch: true, viewport: {width: 360, height: 640}});
    await page.goto(origin + '/test-support/spatial-hud-host.html');
    const result = await page.evaluate(() => {
      const {createSpatialHud, spatialHudCatalog, bindSpatialHudPointer} = window.spatialHud;
      const {OrthographicCamera, Raycaster, Scene, Vector2, WebGLRenderer} = window.three;
      const parent = new Scene();
      const camera = new OrthographicCamera(-0.6, 0.6, 0.1, -0.3, 0.1, 10);
      camera.position.z = 3;
      camera.updateMatrixWorld();
      const renderer = new WebGLRenderer();
      renderer.setSize(360, 120);
      const canvas = renderer.domElement;
      document.body.style.margin = '0';
      canvas.style.touchAction = 'none';
      document.body.append(canvas);
      const accessibilityRoot = document.body.appendChild(document.createElement('div'));
      const raycaster = new Raycaster();
      const actions = [];
      let compact = false;
      const hud = createSpatialHud({parent, document, accessibilityRoot, controlStyle: 'optical',
        controlIconOnly: surfaceId => compact && surfaceId === 'dock',
        send: ({action}) => actions.push(action.name),
      });
      const receive = (type, fields) => hud.receive({version: '1.0', [type]: {surfaceId: 'dock', ...fields}});
      const controls = Object.entries({map: 'Minimapa', conversation: 'Conversar',
        appearance: 'Apariencia', video: 'Video', activity: 'Actividad'});
      receive('createSurface', {catalogId: spatialHudCatalog.id});
      receive('updateComponents', {components: [
        {id: 'root', component: 'HudPanel', width: 1.06, gap: 0, children: ['row']},
        {id: 'row', component: 'HudRow', gap: 0.02, children: controls.map(([id]) => id)},
        ...controls.map(([id, label]) => ({id, component: 'HudButton', label,
          icon: id === 'activity' ? 'unknown-glyph' : id, action: {event: {name: id}}})),
      ]});
      hud.setTextDensity('dock', {cssPixelsPerUnit: 300, pixelRatio: 2});
      const render = () => { hud.update(); renderer.render(parent, camera); };
      render();
      const map = parent.getObjectByName('map');
      const texture = row => row.children.find(child => child.material.map).material.map;
      const mapLabel = texture(map);
      const fallback = texture(parent.getObjectByName('activity'));
      const [button] = accessibilityRoot.querySelectorAll('button');
      button.focus();
      compact = true;
      render();
      const glyph = texture(map);
      const {width, height} = glyph.image;
      const pixels = glyph.image.getContext('2d').getImageData(0, 0, width, height).data;
      let minX = width;
      let maxX = -1;
      for (let i = 3; i < pixels.length; i += 4) {
        if (pixels[i] === 0) continue;
        const x = Math.floor(i / 4) % width;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
      }
      const centered = maxX > minX && Math.abs((maxX + minX) / 2 - width / 2) <= 2;
      const target = map.children[0].geometry.parameters;
      bindSpatialHudPointer({element: canvas, hud, rayForPointer(event) {
        const box = canvas.getBoundingClientRect();
        raycaster.setFromCamera(new Vector2((event.clientX - box.left) / box.width * 2 - 1,
          1 - (event.clientY - box.top) / box.height * 2), camera);
        return {ray: raycaster.ray};
      }});
      window.dockActions = actions;
      return {centered, switchedTexture: mapLabel !== glyph, keptFocus: button === document.activeElement,
        fallbackKept: fallback === texture(parent.getObjectByName('activity')),
        names: Array.from(accessibilityRoot.querySelectorAll('button'), item => item.getAttribute('aria-label')),
        width: target.width * map.scale.x * 300, height: target.height * 300,
        x: (map.position.x + 0.6) * 300, y: (0.1 - map.position.y) * 300};
    });
    assert.deepEqual(result.names, ['Minimapa', 'Conversar', 'Apariencia', 'Video', 'Actividad']);
    assert.ok(result.width >= 44 && result.height >= 44);
    assert.ok(result.centered && result.switchedTexture && result.keptFocus && result.fallbackKept);
    await page.touchscreen.tap(result.x + result.width / 2 - 3, result.y);
    await page.waitForFunction(() => window.dockActions.length === 1);
    assert.deepEqual(await page.evaluate(() => window.dockActions), ['map']);
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
        let sharedSurfaces;
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
        mount('shared', 'showMap', 'toggleSharedSound');
        let movement = 0;
        document.addEventListener('keydown', event => {
          if (hud.handleKey(event, {surfaceId: currentSurface, surfaceIds: sharedSurfaces})) event.preventDefault();
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
          includeShared() {
            sharedSurfaces = ['app', 'world', 'shared'];
            hud.setInteractionScope({surfaceIds: ['app', 'shared'], blockOutside: true});
          },
          close() {
            send('deleteSurface', {surfaceId: 'app'});
            sharedSurfaces = undefined;
            hud.setInteractionScope();
            currentSurface = 'world';
            hud.focusControl(currentSurface, this.prior.instanceId);
          },
        };
      });
    }));
    const [first, second] = pages;
    const focus = page => page.evaluate(() => window.fixture.hud.currentFocus());
    assert.equal(await first.evaluate(() => window.fixture.hud.handleKey(new KeyboardEvent('keydown', {key: ' '}))), false);
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
    await first.evaluate(() => window.fixture.includeShared());
    await first.keyboard.press('Tab');
    assert.deepEqual(await focus(first), {surfaceId: 'shared', instanceId: 'showMap'});
    await first.keyboard.press('Shift+Tab');
    assert.deepEqual(await focus(first), {surfaceId: 'app', instanceId: 'closeTable'});
    await first.keyboard.press('Shift+Tab');
    assert.deepEqual(await focus(first), {surfaceId: 'shared', instanceId: 'toggleSharedSound'});
    await first.keyboard.press('Enter');
    await first.waitForFunction(() => window.fixture.sent.length === 3);
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
    assert.deepEqual(readback, {actions: [
      ['openTable', 'world', 1], ['closeTable', 'app', 8], ['toggleSharedSound', 'shared', 1],
    ], movement: 2});
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
            return hud.group.getObjectByName('hud-choice-options')?.children
              .filter(child => child.name === 'hud-choice-option' || child.name === 'hud-choice-page').length ?? 0;
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
            const positions = panel.getObjectByName('hud-choice-options').children.map(cell =>
              (1 - cell.getWorldPosition(new Vector3()).project(camera).y) * height / 2);
            panel.matrixAutoUpdate = true;
            panel.updateMatrix();
            return positions;
          },
          setPageSize(size) { return hud.setChoicePageSize(surfaceId, size); },
          dismiss(surface = surfaceId) { return hud.dismissChoice(surface); },
          enableOverlay() {
            send('updateComponents', {surfaceId, components: [
              {id: 'root', component: 'HudPanel', children: ['part', 'hint', 'reset', 'other']},
              {id: 'hint', component: 'HudText', label: 'Estado'},
              {id: 'reset', component: 'HudButton', label: 'Restablecer', action: {event: {name: 'reset'}}},
              {id: 'other', component: 'HudButton', label: 'Otro mando', action: {event: {name: 'other'}}},
            ]});
            hud.setChoicePageSize(surfaceId, 1);
            return hud.setChoicePresentation(surfaceId, 'overlay');
          },
          setDensity(pixelRatio) {
            hud.setTextDensity(surfaceId, {cssPixelsPerUnit: 200, pixelRatio});
            hud.update();
            const option = hud.group.getObjectByName('hud-choice-option');
            return option.children.find(child => child.material?.map).material.map.image.width;
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
    const firstWidth = await first.evaluate(() => window.fixture.setDensity(1));
    const secondWidth = await first.evaluate(() => window.fixture.setDensity(2));
    assert.equal(secondWidth, firstWidth * 2);
    assert.equal(await menuLength(first), 4);
    const full = await bounds(first);
    assert.equal(await first.evaluate(() => window.fixture.setPageSize(2)), true);
    assert.equal(await menuLength(first), 3);
    assert.ok((await bounds(first)).bottom > full.bottom);
    assert.equal(await menuLength(second), 0);
    assert.equal(await click(first, -0.27), true);
    assert.equal(await menuLength(first), 4);
    assert.equal(await click(first, -0.81), true);
    assert.equal(await menuLength(first), 3);
    assert.equal(await first.evaluate(() => window.fixture.actions.length), 2);
    await first.evaluate(() => window.fixture.setPageSize());
    assert.equal(await menuLength(first), 4);
    await first.keyboard.press('ArrowUp');
    await first.keyboard.press('Enter');
    await first.waitForFunction(() => window.fixture.actions.length === 3);
    assert.equal(await menuLength(first), 0);
    assert.equal(await first.evaluate(() => window.fixture.enableOverlay()), true);
    const overlayBounds = await bounds(first);
    assert.equal(await click(first, -0.09), true);
    assert.equal(await menuLength(first), 2);
    assert.deepEqual(await bounds(first), overlayBounds);
    assert.equal(await click(first, -0.27), true);
    assert.equal(await menuLength(first), 3);
    assert.deepEqual(await bounds(first), overlayBounds);
    assert.equal(await first.evaluate(() => window.fixture.actions.length), 3);
    assert.equal(await click(first, -0.09), true);
    assert.equal(await menuLength(first), 0);
    assert.equal(await first.evaluate(() => window.fixture.actions.length), 3);
    assert.equal(await click(first, -0.63), true);
    await first.waitForFunction(() => window.fixture.actions.at(-1)?.name === 'other');
    assert.equal(await click(first, -0.09), true);
    assert.equal(await first.evaluate(() => window.fixture.dismiss('elsewhere')), false);
    assert.ok(await menuLength(first));
    assert.equal(await first.evaluate(() => window.fixture.dismiss()), true);
    assert.equal(await menuLength(first), 0);
    assert.equal(await first.evaluate(() => window.fixture.actions.length), 4);

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
        const hud = createSpatialHud({parent: new Scene(), document, retainTextDrafts: true, send: envelope => output.push(envelope)});
        const surfaceId = 'conversation';
        const send = (name, body) => hud.receive({version: '1.0', [name]: body});
        const state = (revision, text = '', disabled = false, visible = true) => send('updateDataModel', {
          surfaceId, value: {revision, text, draft: text, disabled, visible},
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
            visible: {'@path': '/visible'}, disabled: {'@path': '/disabled'}, action},
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
    await first.evaluate(() => {window.fixture.state(2, '', false, false); window.fixture.hud.update();});
    assert.equal(await native.count(), 0);
    assert.deepEqual(await first.evaluate(() => window.fixture.output), []);
    await first.evaluate(() => window.fixture.state(2));
    await first.evaluate(() => window.fixture.click(-0.17));
    assert.equal(await native.inputValue(), 'Desde acá\nま');
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
    await first.keyboard.insertText('Borrador viejo');
    await first.evaluate(() => {window.fixture.state(4, '', false, false); window.fixture.hud.update();});
    await first.evaluate(() => window.fixture.state(5, 'Nueva nota'));
    await first.evaluate(() => window.fixture.click(-0.17));
    assert.equal(await native.inputValue(), 'Nueva nota');
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
      const hud = createSpatialHud({parent: scene, document, controlStyle: 'optical',
        send: envelope => actions.push(envelope.action)});
      const raycaster = new Raycaster();
      const surfaceId = 'worktable';
      const send = (name, body) => hud.receive({version: '1.0', [name]: body});
      const state = (value, revision, {min = 0, max = 1, step = 0.1, clip = 'walk',
        markers = [0, 0.3, 0.7, 1, 1, -1, 'not a frame']} = {}) =>
        send('updateDataModel', {surfaceId, value: {value, proposal: value, revision, min, max, step, clip, markers}});
      const cut = name => ({id: 'cut', component: 'HudRange', label: 'Corte',
        min: {'@path': '/min'}, max: {'@path': '/max'}, step: {'@path': '/step'},
        markers: {'@path': '/markers'},
        gestureKey: {'@path': '/clip'}, value: {'@path': '/value'}, draft: {'@path': '/proposal'},
        action: {event: {name, context: {value: {'@path': '/proposal'}, revision: {'@path': '/revision'},
          clip: {'@path': '/clip'}}}}});
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
          const progress = cut.getObjectByName('hud-range-progress');
          const markers = cut.getObjectByName('hud-range-markers');
          const matrix = new window.three.Matrix4();
          const markedPositions = markers?.visible ? Array.from({length: markers.count}, (_, index) => {
            markers.getMatrixAt(index, matrix);
            return Number(matrix.elements[12].toFixed(3));
          }) : [];
          const knob = cut.children.find(child => child.geometry?.parameters.width === 0.035);
          return {visible: preview.visible, preview: preview.position.x, confirmed: knob.position.x,
            progress: progress.scale.x, progressVisible: progress.visible,
            progressColor: progress.material.color.getHexString(), markedPositions};
        },
      };
    });
    const canvas = await page.locator('canvas').boundingBox();
    const point = x => ({x: canvas.x + (x + 1) * canvas.width / 2, y: canvas.y + canvas.height * 0.488});
    const move = async x => { const target = point(x); await page.mouse.move(target.x, target.y); };
    const read = () => page.evaluate(() => window.fixture.read());
    const actions = () => page.evaluate(() => window.fixture.actions.map(({context}) => context));
    const initial = await read();
    assert.equal(initial.progress, 0.3);
    assert.equal(initial.progressVisible, true);
    assert.equal(initial.progressColor, 'f2ce85');
    assert.deepEqual(initial.markedPositions, [0.098, 0.266, 0.49, 0.658]);
    await move(0.18);
    await page.mouse.down();
    await move(0.59);
    const pending = await read();
    assert.equal(pending.visible, true);
    assert.equal(pending.confirmed, initial.confirmed);
    assert.equal(pending.progress, initial.progress);
    assert.deepEqual(pending.markedPositions, initial.markedPositions);
    assert.ok(pending.preview > pending.confirmed);
    assert.deepEqual(await actions(), []);
    await page.mouse.up();
    await page.waitForFunction(() => window.fixture.actions.length === 1);
    assert.deepEqual(await actions(), [{value: 0.9, revision: 1, clip: 'walk'}]);
    assert.equal((await read()).visible, false);
    assert.equal((await read()).confirmed, initial.confirmed);
    assert.equal((await read()).progress, initial.progress);
    await page.evaluate(() => window.fixture.state(0.9, 2));
    assert.equal((await read()).confirmed, pending.preview);
    assert.equal((await read()).progress, 0.9);

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
    // A CDP reply can precede browser dispatch of pointercancel.
    await page.waitForFunction(() => !window.fixture.read().visible);
    assert.equal((await actions()).length, 1);
    await touch('touchStart', 0.48);
    await touch('touchMove', 0.38);
    await touch('touchEnd');
    await page.waitForFunction(() => window.fixture.actions.length === 2);
    assert.deepEqual(await actions(), [{value: 0.9, revision: 1, clip: 'walk'}, {value: 0.5, revision: 3, clip: 'walk'}]);
    await move(0.48);
    await page.mouse.down();
    assert.equal((await read()).visible, true);
    await page.evaluate(() => window.fixture.replaceAction());
    assert.equal((await read()).visible, false);
    await page.mouse.up();
    assert.equal((await actions()).length, 2);

    await page.mouse.down();
    assert.equal((await read()).visible, true);
    await page.evaluate(() => window.fixture.state(0.7, 4, {clip: 'hover'}));
    assert.equal((await read()).visible, false);
    await page.mouse.up();
    assert.equal((await actions()).length, 2);

    await page.evaluate(() => window.fixture.state(16, 5, {min: 8, max: 24, step: 1, clip: 'hover'}));
    await move(0.24);
    await page.mouse.down();
    assert.equal((await read()).visible, true);
    await page.evaluate(() => window.fixture.state(16, 6, {min: 8, max: 32, step: 1, clip: 'hover'}));
    assert.equal((await read()).visible, false);
    await page.mouse.up();
    assert.equal((await actions()).length, 2);
    await move(0.38);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForFunction(() => window.fixture.actions.length === 3);
    assert.deepEqual((await actions()).at(-1), {value: 20, revision: 6, clip: 'hover'});
    assert.equal(await page.evaluate(() => window.fixture.worldClicks()), 0);
    await page.evaluate(() => window.fixture.state(8, 7, {min: 8, max: 32, step: 1, clip: 'hover'}));
    assert.equal((await read()).progressVisible, false);
    assert.deepEqual((await read()).markedPositions, []);
    await page.evaluate(() => window.fixture.state(8, 8, {min: 8, max: 32, markers: Array.from({length: 17}, (_, i) => i + 8)}));
    assert.deepEqual((await read()).markedPositions, []);
    await page.evaluate(() => window.fixture.state(8, 9, {min: 8, max: 32, markers: [8, 20, 32]}));
    assert.deepEqual((await read()).markedPositions, [0.098, 0.378, 0.658]);
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
      const reflow = () => send('updateComponents', {surfaceId: 'matter', components: [
        {id: 'root', component: 'HudPanel', label: 'Mesa', children: ['part', 'status', 'sound', 'cut', 'search']},
      ]});
      window.fixture = {hud, actions, state, reflow};
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
    await part.focus();
    const focusKept = await part.evaluate(element => {
      window.fixture.reflow();
      window.fixture.hud.update();
      return element === document.activeElement;
    });
    assert.equal(focusKept, true, 'Reordering the same interactive control must retain keyboard focus');
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
        label, disabled: {'@path': '/disabled'}, gestureKey: {'@path': '/selection'},
        action: {event: {name, ...(name === 'visit' ? {context: {selection: {'@path': '/selection'}}} : {})}}});
      function create(name) {
        send('createSurface', {surfaceId, catalogId: spatialHudCatalog.id});
        send('updateDataModel', {surfaceId, value: {label: 'Mesa', section: 0.3, draft: 0.3, disabled: false, selection: 'pose-a'}});
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
        select(value) { send('updateDataModel', {surfaceId, path: '/selection', value}); },
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
    await page.mouse.down();
    await page.evaluate(() => {
      const {hud, disabled} = window.fixture;
      disabled(true);
      hud.update();
      disabled(false);
      hud.update();
    });
    await page.mouse.up();
    assert.deepEqual(await actions(), [['open', {}]]);
    await page.mouse.down();
    await page.evaluate(() => window.fixture.select('pose-b'));
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
    assert.deepEqual(await actions(), [['open', {}], ['visit', {selection: 'pose-b'}], ['setSection', {value: 0.8}]]);
    const rangeReplacement = await page.evaluate(async ({first, second}) => {
      const canvas = document.querySelector('canvas');
      const {hud, actions} = window.fixture;
      // Dispatch two independent Pointer Events. Native capture and ordinary
      // mouse/touch delivery are exercised earlier in this check.
      canvas.setPointerCapture = () => {};
      const dispatch = (type, pointerId, [clientX, clientY]) => canvas.dispatchEvent(new PointerEvent(type, {
        pointerType: 'touch', pointerId, clientX, clientY, bubbles: true, cancelable: true,
      }));
      const flush = () => new Promise(resolve => setTimeout(resolve, 0));
      const counts = [];
      for (const [index, release] of ['pointerup', 'pointercancel'].entries()) {
        const previous = 10 + index * 2;
        const next = previous + 1;
        const originalCount = actions.length;
        dispatch('pointerdown', previous, first);
        hud.setInteractionScope({surfaceIds: [], blockOutside: true});
        hud.setInteractionScope();
        dispatch('pointerdown', next, second);
        dispatch('pointermove', previous, first);
        dispatch(release, previous, first);
        await flush();
        counts.push(actions.length - originalCount);
        dispatch('pointerup', next, second);
        await flush();
        counts.push(actions.length - originalCount);
      }
      return counts;
    }, {first: point(0.20, -0.27), second: point(0.54, -0.27)});
    assert.deepEqual(rangeReplacement, [0, 1, 0, 1]);
    assert.deepEqual((await actions()).slice(3), Array(2).fill(['setSection', {value: 0.8}]));
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
      const {OrthographicCamera, Ray, Raycaster, Scene, Vector2, Vector3} = window.three;
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
        {id: 'root', component: 'HudPanel', width: 1.8, label: 'Movimiento', chrome: 'none', children: ['row']},
        {id: 'row', component: 'HudRow', children: ['stick', 'jump']},
        {id: 'stick', component: 'HudStick', label: 'Moverse'},
        {id: 'jump', component: 'HudJump', label: 'Saltar', iconOnly: true},
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
      hud.setTextDensity(surfaceId, {cssPixelsPerUnit: 145});
      let worldDown = 0;
      canvas.addEventListener('pointerdown', () => worldDown++);
      hud.update();
      window.fixture = {
        hud, actions, worldDown: () => worldDown,
        noPlate: Boolean(hud.getSurfaceBounds(surfaceId)) &&
          !hud.pointerTarget(new Ray(new Vector3(0, -.25, 3), new Vector3(0, 0, -1))),
        movementGlyphs() {
          const result = [];
          for (const [label, vertical] of [['Saltar', undefined], ['Subir', 1], ['Bajar', -1], ['Saltar', undefined]]) {
            send('updateComponents', {surfaceId, components: [
              {id: 'jump', component: 'HudJump', label, iconOnly: true, ...(vertical ? {vertical} : {})},
            ]});
            hud.update();
            const texture = hud.group.getObjectByName('jump').children.find(mesh => mesh.material.map).material.map;
            const canvas = texture.image;
            const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
            const rows = new Set();
            for (let i = 3; i < pixels.length; i += 4) {
              if (pixels[i] > 127) rows.add(Math.floor(i / 4 / canvas.width));
            }
            result.push({image: canvas.toDataURL(), paintedHeight: rows.size});
          }
          return result;
        },
        read() {
          const stick = hud.group.getObjectByName('stick').getObjectByName('hud-locomotion-indicator');
          const jump = hud.group.getObjectByName('jump').getObjectByName('hud-locomotion-indicator');
          return {input: hud.locomotionInput.getOutput(), stickY: stick.position.y, jump: jump.visible};
        },
      };
    });
    const glyphs = await page.evaluate(() => window.fixture.movementGlyphs());
    assert.equal(await page.evaluate(() => window.fixture.noPlate), true);
    assert.equal(new Set(glyphs.map(glyph => glyph.image)).size, 3);
    assert.deepEqual(glyphs[0], glyphs[3]);
    assert.ok(glyphs.every(glyph => glyph.paintedHeight >= 13));
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

test('multiline HUD notices retain display density within the texture budget', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    await page.goto(origin + '/test-support/spatial-hud-host.html');
    const notice = 'Aviso de la mesa\n'.repeat(7) + 'Edición confirmada';
    const result = await page.evaluate(notice => {
      const {createSpatialHud, spatialHudCatalog} = window.spatialHud;
      const scene = new window.three.Scene();
      const hud = createSpatialHud({parent: scene, document, accessibilityRoot: document.body});
      const surfaceId = 'notice';
      hud.receive({version: '1.0', createSurface: {surfaceId, catalogId: spatialHudCatalog.id}});
      hud.receive({version: '1.0', updateComponents: {surfaceId, components: [
        {id: 'root', component: 'HudPanel', width: 2, children: ['heading', 'status']},
        {id: 'heading', component: 'HudText', label: 'Conversar\nTema del taller',
          style: 'title', lines: 2, icon: 'conversation'},
        {id: 'status', component: 'HudText', label: notice, style: 'status', lines: 8},
      ]}});
      const dimensions = (cssPixelsPerUnit, pixelRatio) => {
        hud.setTextDensity(surfaceId, {cssPixelsPerUnit, pixelRatio});
        hud.update();
        const {width, height} = scene.getObjectByName('status').children
          .find(child => child.material.map).material.map.image;
        return [width, height];
      };
      hud.setPalette({focus: '#ff3200', text: '#ffffff'});
      const dense = dimensions(320, 2);
      const readHeading = channel => {
        const image = scene.getObjectByName('heading').children.find(child => child.material.map).material.map.image;
        const data = image.getContext('2d').getImageData(0, 0, image.width, image.height).data;
        let icon = 0, body = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] > 100 && data[i + channel] > 200 && data[i + (channel ? 0 : 2)] < 100) icon++;
          if (i > data.length / 2 && data[i + 3] > 100 && data[i] > 200 && data[i + 1] > 200 && data[i + 2] > 200) body++;
        }
        return {icon, body};
      };
      const first = readHeading(0);
      hud.setPalette({focus: '#22ddff', text: '#ffffff'});
      hud.update();
      const afterTheme = readHeading(2);
      const bounded = dimensions(1024, 4);
      const announced = document.querySelector('[data-spatial-hud-accessibility] [role="status"]').textContent;
      hud.dispose();
      return {dense, bounded, announced, first, afterTheme};
    }, notice);
    assert.deepEqual(result.dense, [1280, 455]);
    assert.ok(result.bounded[0] * result.bounded[1] <= 1048576);
    assert.equal(result.announced, notice);
    assert.ok(result.first.icon > 3 && result.first.body > 8);
    assert.ok(result.afterTheme.icon > 3);
    assert.equal(result.afterTheme.body, result.first.body);
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('screen-space HUD lettering follows surface width and live DPR', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    await page.goto(origin + '/test-support/spatial-hud-host.html');
    const result = await page.evaluate(() => {
      const {createSpatialHud, spatialHudCatalog} = window.spatialHud;
      const {Scene} = window.three;
      const scene = new Scene();
      const hud = createSpatialHud({parent: scene, document, accessibilityRoot: document.body});
      const surfaceId = 'toolbelt';
      const receive = (name, body) => hud.receive({version: '1.0', [name]: {surfaceId, ...body}});
      receive('createSurface', {catalogId: spatialHudCatalog.id});
      receive('updateDataModel', {value: {message: 'Parte seleccionada'}});
      receive('updateComponents', {components: [
        {id: 'root', component: 'HudPanel', width: 2, children: ['row', 'status', 'message', 'jump']},
        {id: 'row', component: 'HudRow', gap: 0, children: ['map', 'talk']},
        {id: 'map', component: 'HudButton', label: 'Minimapa de la estación orbital', weight: 1, action: {event: {name: 'showMap'}}},
        {id: 'talk', component: 'HudButton', label: 'Conversar', weight: 3, action: {event: {name: 'showConversation'}}},
        {id: 'status', component: 'HudText', label: 'Mesa\nParte\nConfirmada', style: 'status', lines: 3},
        {id: 'message', component: 'HudTextInput', label: 'Mensaje', value: {'@path': '/message'}, draft: {'@path': '/draft'}, action: {event: {name: 'sendMessage'}}},
        {id: 'jump', component: 'HudJump', label: 'Saltar'},
      ]});
      const texture = id => scene.getObjectByName(surfaceId).getObjectByName(id).children
        .find(child => child.material.map).material.map;
      const sizes = () => ['map', 'talk', 'status', 'message', 'jump'].map(id => {
        const map = texture(id);
        return [map.image.width, map.image.height, map.generateMipmaps];
      });
      hud.setTextDensity(surfaceId, {cssPixelsPerUnit: 200, pixelRatio: 1.5});
      hud.update();
      const fullName = document.querySelector('[data-spatial-hud-accessibility] button').getAttribute('aria-label');
      const first = sizes(), stable = texture('map');
      hud.setTextDensity(surfaceId, {cssPixelsPerUnit: 200, pixelRatio: 1.5});
      hud.update();
      const reused = stable === texture('map');
      hud.setTextDensity(surfaceId, {cssPixelsPerUnit: 200, pixelRatio: 2});
      hud.update();
      const changed = sizes();
      hud.setTextDensity(surfaceId);
      hud.update();
      const restored = sizes();
      receive('updateComponents', {components: [
        {id: 'root', component: 'HudPanel', width: 0.5, children: ['row']},
        {id: 'row', component: 'HudRow', gap: 0, children: ['stick', 'jump']},
        {id: 'stick', component: 'HudStick', label: 'Moverse'},
        {id: 'jump', component: 'HudJump', label: 'Saltar'},
      ]});
      hud.setTextDensity(surfaceId, {cssPixelsPerUnit: 200, pixelRatio: 1.5});
      hud.update();
      const jump = texture('jump').image;
      const compactJump = [jump.width, jump.height];
      receive('updateComponents', {components: [
        {id: 'root', component: 'HudPanel', width: 0.5, children: ['chrome']},
        {id: 'chrome', component: 'HudButton', label: 'Minimizar conversación', icon: 'minimize', quiet: true,
          action: {event: {name: 'minimize'}}},
      ]});
      hud.update();
      const nameWithIcon = document.querySelector('[data-spatial-hud-accessibility] button').getAttribute('aria-label');
      const canvas = texture('chrome').image;
      const pixel = (x, y) => canvas.getContext('2d').getImageData(x, y, 1, 1).data[3];
      const iconPainted = pixel(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)) > 0
        && pixel(0, 0) === 0;
      const chrome = scene.getObjectByName(surfaceId).getObjectByName('chrome');
      const quietSurface = chrome.children.some(child => child.material.opacity === 0.06);
      hud.dispose();
      return {first, changed, reused, restored, fullName, compactJump, nameWithIcon, iconPainted, quietSurface};
    });
    assert.deepEqual(result.first, [[150, 46, false], [450, 46, false], [600, 87, false], [600, 94, false], [124, 46, false]]);
    assert.deepEqual(result.changed, [[200, 62, false], [600, 62, false], [800, 116, false], [800, 126, false], [166, 62, false]]);
    assert.equal(result.reused, true);
    assert.equal(result.fullName, 'Minimapa de la estación orbital');
    assert.deepEqual(result.restored, [[259, 80, true], [778, 80, true], [1038, 151, true], [1038, 164, true], [215, 80, true]]);
    assert.deepEqual(result.compactJump, [62, 23]);
    assert.equal(result.nameWithIcon, 'Minimizar conversación');
    assert.equal(result.iconPainted, true);
    assert.equal(result.quietSurface, true);
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('narrow status text wraps long names without splitting graphemes or shrinking lines', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    await page.goto(origin + '/test-support/spatial-hud-host.html');
    const result = await page.evaluate(() => {
      const {createSpatialHud, spatialHudCatalog} = window.spatialHud;
      const hud = createSpatialHud({parent: new window.three.Scene(), document, accessibilityRoot: document.body});
      const surfaceId = 'notice';
      hud.receive({version: '1.0', createSurface: {surfaceId, catalogId: spatialHudCatalog.id}});
      const label = 'A\u0301'.repeat(20) + '\n\n\n';
      const calls = [];
      const original = CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText = function (text, x, y, maxWidth) {
        calls.push({text, maxWidth, fits: this.measureText(text).width <= this.canvas.width - 2 * x});
        original.apply(this, arguments);
      };
      try {
        const show = (label, lines) => hud.receive({version: '1.0', updateComponents: {surfaceId, components: [
          {id: 'root', component: 'HudPanel', width: 0.8, children: ['status']},
          {id: 'status', component: 'HudText', label, style: 'status', lines},
        ]}});
        show(label, 4);
        hud.update();
        hud.setTextDensity(surfaceId, {cssPixelsPerUnit: 100, pixelRatio: 2});
        calls.length = 0;
        hud.update();
        const rows = calls.filter(call => call.text);
        const announced = document.querySelector('[role="status"]').textContent;
        calls.length = 0;
        show(label.trimEnd().repeat(10), 2);
        hud.update();
        return {rows, announced, label, clipped: calls.filter(call => call.text)};
      } finally {
        CanvasRenderingContext2D.prototype.fillText = original;
        hud.dispose();
      }
    });
    assert.ok(result.rows.length > 1, JSON.stringify(result));
    assert.equal(result.rows.map(row => row.text).join(''), result.label.trimEnd());
    assert.ok(result.rows.every(row => /^(?:A\u0301)+$/u.test(row.text) && row.fits && row.maxWidth === undefined));
    assert.equal(result.announced, result.label);
    assert.equal(result.clipped.length, 2);
    assert.ok(result.clipped[1].text.endsWith('…') && result.clipped.every(row => row.fits));
  }, process.env.PROYECCION_BROWSER_PROJECT);
});
