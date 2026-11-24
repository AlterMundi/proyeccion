import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {parse} from 'yaml';
import {assertComponent} from '../test-support/accessibility.js';
import {assertViewTree, matchOutput, userInput} from '../test-support/adapter-fixture.js';
import {assertWireMessage} from '../test-support/wire-check.js';
import {withBrowser} from '../test-support/browser.js';
import {record} from '../test-support/conformance-manifest.js';
import {basicCatalog, createProtocol} from '../src/protocol.js';

const suite = 'core/adapter_conformance.yaml';
const cases = parse(readFileSync(new URL('./fixtures/a2ui-v1/adapter_conformance.yaml', import.meta.url), 'utf8'));
const supported = new Set([
  'tree_hierarchy_declared_order', 'single_message_v10_surface_render',
  'media_components_bind_url_and_name', 'tabs_switch_content',
  'modal_open_shows_content', 'divider_and_slider_datetime_render',
  'progressive_arrival_placeholder_upgrade_in_place',
  'dynamic_repeater_list_insert_delete_reorder_and_index',
  'two_way_binding_control_write_updates_dependents',
  'teardown_unmount_releases_subscriptions', 'delete_surface_unmounts_view',
  'type_change_under_same_id_resets_view_state', 'removed_components_release_subscriptions',
  'two_way_binding_inputs_checkbox_choice_slider_datetime',
  'action_execution_event_vs_local_function_call',
  'user_activation_gated_function_gesture_vs_programmatic',
  'multi_catalog_mixed_surface_rendering',
  'validation_results_error_disables_warning_allows',
  'accessibility_attributes_and_implicit_label_override',
  'agent_function_action_failure_reports_expression_error',
  'v10_theme_dropped_in_permissive_mode_renders_like_none',
]);

function headlessSubscriptionCount(messages) {
  let surface;
  const protocol = createProtocol({send() {}, onSurfaceCreated(created) { surface = created; }});
  try {
    for (const message of messages) protocol.receive(message);
    assert.ok(surface, 'Expected live headless baseline');
    return surface.componentsModel.onCreated.listeners.size
      + surface.componentsModel.onDeleted.listeners.size + surface.dataModel.subscriptions.size;
  } finally {
    protocol.dispose();
  }
}

test('pinned A2UI adapter scenarios through the Three.js surface', {timeout: 55000}, async t => {
  await withBrowser(async (browser, origin) => {
    for (const entry of cases) {
      if (!supported.has(entry.name)) {
        assert.equal(entry.name, 'fallback_states_unknown_type_and_cyclic_diagnostics');
        record(suite, entry.name, 'skipped',
          'Web Core 0.16.1 rejects cycles atomically before the view resolver. The split browser test records actual behavior.');
        continue;
      }
      await t.test(entry.name, async () => {
        let page;
        try {
          assert.equal(entry.protocolVersion, '1.0');
          assert.equal(entry.action, 'render_surface');
          page = await browser.newPage({viewport: {width: 1000, height: 800}});
          page.setDefaultTimeout(4500);
          const catalogRequests = [];
          page.on('request', request => {
            if (entry.catalogs?.some(catalog => catalog.catalogId === request.url())) {
              catalogRequests.push(request.url());
            }
          });
          await page.route('https://example.com/**', route => route.abort());
          await page.goto(origin + '/test-support/fixture-host.html');
          const localCounter = entry.name === 'action_execution_event_vs_local_function_call'
            || entry.name === 'agent_function_action_failure_reports_expression_error';
          if (localCounter || entry.catalogs) {
            await page.evaluate(options => window.fixture.configure(options),
              {increment: localCounter, secondary: entry.catalogs ?? []});
          }
          const activationCase = entry.name === 'user_activation_gated_function_gesture_vs_programmatic';
          if (activationCase) {
            await page.evaluate(() => {
              window.fixture.opened = [];
              window.open = url => {
                window.fixture.opened.push({url, active: navigator.userActivation.isActive});
                return null;
              };
            });
          }
          let lastCallId;
          for (const step of entry.steps) {
            await page.evaluate(() => window.fixture.snapshot());
            if (step.op === 'process_messages') {
              const messages = step.messages.map(message => {
                if (message.agentFunctionResponse?.functionCallId?.$ref !== 'lastCallId') return message;
                assert.ok(lastCallId);
                return {...message, agentFunctionResponse: {...message.agentFunctionResponse, functionCallId: lastCallId}};
              });
              await page.evaluate(messages => {
                for (const message of messages) window.fixture.projection.receive(message);
              }, messages);
              if (step.expectSurfaceRemoved) {
                await page.locator('a2ui-surface').waitFor({state: 'detached'});
              } else {
                await page.waitForFunction(() => document.querySelector('a2ui-surface')?.rootNode);
              }
            } else if (step.op === 'user_input') {
              await userInput(page, step);
            } else if (step.op === 'unmount_surface') {
              await page.locator('a2ui-surface').evaluate(element => element.remove());
            } else if (step.op === 'user_gesture') {
              assert.equal(step.userActivation ?? true, true);
              await page.evaluate(() => window.fixture.markInputs());
              await page.locator('[data-fixture-component="' + step.targetNode + '"]').getByRole('button').click();
              if (entry.name === 'modal_open_shows_content') await page.getByRole('dialog').waitFor();
            } else if (step.op === 'programmatic_invoke') {
              assert.equal(step.userActivation, false);
              await page.evaluate(id => {
                window.fixture.markInputs();
                const {componentModel, dataContext} =
                  document.querySelector('[data-fixture-component="' + id + '"]').context;
                return dataContext.resolveAction(componentModel.properties.action, {userActivation: false});
              }, step.targetNode);
            } else {
              throw new Error('Unsupported fixture operation: ' + step.op);
            }
            if (step.expectViewTree) await assertViewTree(page, step.expectViewTree);
            if (step.expectDataModel) {
              const model = await page.evaluate(() => document.querySelector('a2ui-surface').surface.dataModel.get('/'));
              assert.deepEqual(model, step.expectDataModel);
            }
            if (step.expectThemeAbsent) {
              const theme = await page.evaluate(() => {
                const surface = document.querySelector('a2ui-surface');
                const hasColor = [...surface.querySelectorAll('*')].some(element =>
                  element.style.getPropertyValue('--a2ui-color-primary')
                  || /#ff00aa|255, 0, 170/i.test(element.getAttribute('style') ?? ''));
                return {theme: surface.surface.theme ?? {}, hasColor};
              });
              assert.deepEqual(theme, {theme: {}, hasColor: false});
            }
            if (step.expectAccessibilityTree) {
              for (const [id, expected] of Object.entries(step.expectAccessibilityTree)) {
                await assertComponent(page, id, expected);
              }
            }
            if (step.expectActions || step.expectOutbound || step.expectErrors) {
              if (step.expectOutbound?.length) {
                await page.waitForFunction(amount => window.fixture.outbound.length >= amount, step.expectOutbound.length);
              }
              const messages = await page.evaluate(() => window.fixture.outbound.splice(0).map(row => row.message));
              for (const message of messages) assertWireMessage(message, {}, entry.catalogs);
              if (step.expectOutbound) assert.deepEqual(messages, matchOutput(messages, step.expectOutbound));
              if (step.expectActions) {
                assert.deepEqual(messages.filter(msg => msg.action).map(({action}) => {
                  const {timestamp, ...data} = action;
                  assert.ok(Number.isFinite(Date.parse(timestamp)));
                  return data;
                }), step.expectActions);
              }
              if (step.expectErrors) {
                const errors = messages.filter(msg => msg.error).map(msg => msg.error);
                assert.equal(errors.length, step.expectErrors.length);
                for (const [index, expected] of step.expectErrors.entries()) {
                  const error = errors[index];
                  if (expected.code) assert.equal(error.code, expected.code);
                  if (error.functionCallId) assert.equal(error.functionCallId, lastCallId);
                  else if (expected.surfaceId) assert.equal(error.surfaceId, expected.surfaceId);
                  if (expected.message) assert.ok(error.message.includes(expected.message));
                }
              }
              lastCallId = messages.find(msg => msg.callAgentFunction)?.callAgentFunction.functionCallId ?? lastCallId;
            }
            const lifecycle = await page.evaluate(step => window.fixture.compareViews(step), step);
            if (step.expectSameViewIdentity) assert.deepEqual(lifecycle.same, step.expectSameViewIdentity.map(() => true));
            if (step.expectNewViewIdentity) assert.deepEqual(lifecycle.changed, step.expectNewViewIdentity.map(() => true));
            if (step.expectDisposedNodes) assert.deepEqual(lifecycle.disposed, step.expectDisposedNodes.map(() => true));
            if (step.expectSurfaceRemoved !== undefined) assert.equal(lifecycle.removed, step.expectSurfaceRemoved);
            if (step.expectActiveSubscriptions !== undefined) {
              // Web Core's graph index observes the live model independently
              // of the view. Compare against the same wire scenario headless.
              const baseline = step.op === 'unmount_surface'
                ? headlessSubscriptionCount(entry.steps.flatMap(step => step.messages ?? []))
                : 0;
              assert.equal(lifecycle.surfaceDisposed, step.op !== 'unmount_surface');
              assert.equal(lifecycle.subscriptions - baseline, step.expectActiveSubscriptions);
            }
            const accepted = ['expectViewTree', 'expectDataModel', 'expectActions', 'expectOutbound',
              'expectSameViewIdentity', 'expectNewViewIdentity', 'expectDisposedNodes', 'expectSurfaceRemoved',
              'expectActiveSubscriptions', 'expectAccessibilityTree', 'expectErrors', 'expectThemeAbsent'];
            assert.deepEqual(Object.keys(step).filter(key => key.startsWith('expect') && !accepted.includes(key)), []);
          }
          if (activationCase) {
            await page.getByRole('button', {name: 'Open External Site'}).evaluate(button => button.click());
            await page.waitForFunction(() => window.fixture.outbound.length === 1);
            const [message] = await page.evaluate(() => window.fixture.outbound.splice(0).map(row => row.message));
            assertWireMessage(message);
            assert.equal(message.error.code, 'EXPRESSION_ERROR');
            assert.match(message.error.message, /openUrl.*active user gesture/);
            assert.deepEqual(await page.evaluate(() => window.fixture.opened), [
              {url: 'https://example.com/', active: true},
            ]);
          }
          if (entry.name === 'media_components_bind_url_and_name') {
            const loaded = await page.evaluate(async () => {
              const element = document.querySelector('a2ui-surface i');
              const family = getComputedStyle(element).fontFamily;
              const faces = await document.fonts.load('24px ' + family, 'check');
              const ctx = document.createElement('canvas').getContext('2d');
              ctx.font = '24px ' + family;
              return {ligatureWidth: ctx.measureText(element.textContent.trim()).width,
                face: faces[0]?.status};
            });
            assert.deepEqual(loaded, {ligatureWidth: 24, face: 'loaded'});
          }
          assert.deepEqual(await page.evaluate(() => window.fixture.outbound), []);
          assert.deepEqual(await page.evaluate(() => window.fixture.failures), []);
          assert.deepEqual(catalogRequests, []);
          record(suite, entry.name, 'passed');
        } catch (error) {
          const details = await page?.evaluate(() => ({
            failures: window.fixture?.failures,
            outbound: window.fixture?.outbound,
            opened: window.fixture?.opened,
          })).catch(() => undefined);
          if (details) error.message += '\nFixture state: ' + JSON.stringify(details).slice(0, 1200);
          record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
          throw error;
        } finally {
          await page?.close();
        }
      });
    }
  });
});

test('unknown widgets leave siblings mounted and a cyclic update preserves the prior scene', async () => {
  const entry = cases.find(entry => entry.name === 'fallback_states_unknown_type_and_cyclic_diagnostics');
  const [original] = entry.steps[0].messages;
  const {surfaceId, components} = original.createSurface;
  const [root, unknown, cycle] = components;
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage({viewport: {width: 1000, height: 800}});
    page.setDefaultTimeout(4500);
    await page.goto(origin + '/test-support/fixture-host.html');
    await page.evaluate(message => window.fixture.projection.receive(message), {
      ...original,
      createSurface: {...original.createSurface, components: [
        root, unknown, {id: cycle.id, component: 'Text', text: 'Still visible'},
      ]},
    });
    await page.getByText('Still visible', {exact: true}).waitFor();
    await page.waitForFunction(() => window.fixture.outbound.length === 1);
    const snapshot = await page.evaluate(id => {
      const surface = document.querySelector('a2ui-surface');
      return {
        missing: window.fixture.pendingChildren(surface.rootNode).map(node => [node.componentId, node.state]),
        message: window.fixture.outbound.shift().message,
        view: surface.textContent.trim(),
        id: surface.surface.id,
        hasFallbackElement: [...surface.querySelectorAll('*')].some(el => el.node?.componentId === id),
      };
    }, unknown.id);
    assert.equal(snapshot.id, surfaceId);
    assert.deepEqual(snapshot.missing, [[unknown.id, 'unknown-type']]);
    assert.equal(snapshot.view, 'Still visible');
    assert.equal(snapshot.hasFallbackElement, false);
    assertWireMessage(snapshot.message);
    assert.equal(snapshot.message.error.code, 'UNKNOWN_COMPONENT_TYPE');

    await page.evaluate(message => window.fixture.projection.receive(message), {
      version: '1.0', updateComponents: {surfaceId, components: [cycle]},
    });
    await page.waitForFunction(() => window.fixture.outbound.length === 1);
    const [error] = await page.evaluate(() => window.fixture.outbound.map(row => row.message));
    assertWireMessage(error);
    assert.equal(error.error.code, 'RECURSION_LIMIT_EXCEEDED');
    assert.equal(error.error.surfaceId, surfaceId);
    assert.match(error.error.message, /Circular reference/);
    assert.equal(await page.getByText('Still visible', {exact: true}).count(), 1);
    assert.equal(await page.locator('a2ui-surface').count(), 1);
    await page.close();
  });
});

test('a spatial Basic Catalog modal manages keyboard focus and returns to its trigger', async () => {
  const modal = cases.find(entry => entry.name === 'modal_open_shows_content');
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage({viewport: {width: 1000, height: 800}});
    page.setDefaultTimeout(3500);
    await page.goto(origin + '/test-support/fixture-host.html');
    await page.evaluate(messages => {
      for (const message of messages) window.fixture.projection.receive(message);
    }, modal.steps[0].messages);
    const trigger = page.getByRole('button', {name: 'Open Details'});
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const close = dialog.getByRole('button', {name: 'Close'});
    assert.equal(await close.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Tab');
    assert.equal(await close.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Escape');
    await dialog.waitFor({state: 'detached'});
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  });
});

test('A2UI media controls decode local images, audio and video', {timeout: 15000}, async () => {
  const create = cases.find(entry => entry.name === 'media_components_bind_url_and_name')
    .steps[0].messages[0];
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    for (const width of [32, 48]) {
      await page.route(`${origin}/fixture-${width}.svg`, route => route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="24">
          <rect width="100%" height="100%" fill="blue"/>
        </svg>`,
      }));
    }
    await page.goto(origin + '/test-support/fixture-host.html');
    await page.evaluate(({message, origin}) => {
      const {createSurface} = message;
      createSurface.dataModel.media.imageUrl = origin + '/fixture-32.svg';
      createSurface.dataModel.media.audioUrl = origin + '/test/fixtures/media/tone.wav';
      createSurface.dataModel.media.videoUrl = origin + '/test/fixtures/media/pattern.webm';
      window.fixture.projection.receive(message);
    }, {message: create, origin});
    const image = page.getByRole('img', {name: 'Hero banner'});
    const measureImage = () => image.evaluate(async element => {
      await element.decode();
      return element.naturalWidth;
    });
    assert.equal(await measureImage(), 32);
    await page.evaluate(({origin, surfaceId}) => window.fixture.projection.receive({
      version: '1.0', updateDataModel: {surfaceId, path: '/media/imageUrl', value: origin + '/fixture-48.svg'},
    }), {origin, surfaceId: create.createSurface.surfaceId});
    await page.waitForFunction(url => document.querySelector('a2ui-surface img')?.src === url,
      origin + '/fixture-48.svg');
    assert.equal(await measureImage(), 48);
    const video = page.locator('a2ui-surface video[controls]');
    const audio = page.locator('a2ui-surface audio[controls]');
    await video.waitFor();
    await audio.waitFor();
    const result = await page.evaluate(async () => {
      const video = document.querySelector('a2ui-surface video');
      const audio = document.querySelector('a2ui-surface audio');
      video.muted = true;
      audio.muted = true;
      const cycle = element => new Promise((resolve, reject) => {
        element.addEventListener('error', () => reject(new Error('Media decode failed')), {once: true});
        element.addEventListener('ended', () => resolve(element.currentTime), {once: true});
        element.play().catch(reject);
      });
      const [videoTime, audioTime] = await Promise.all([cycle(video), cycle(audio)]);
      return {videoTime, audioTime, width: video.videoWidth, height: video.videoHeight};
    });
    assert.equal(result.width, 48);
    assert.equal(result.height, 32);
    assert.ok(result.videoTime >= 0.6);
    assert.ok(result.audioTime >= 0.6);
  });
});

test('Basic Catalog date and time inputs preserve their bound value when edited or cleared', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage({viewport: {width: 1000, height: 800}});
    page.setDefaultTimeout(3500);
    await page.goto(origin + '/test-support/fixture-host.html');
    const receive = body => page.evaluate(body => window.fixture.projection.receive({version: '1.0', ...body}), body);
    const catalogId = 'https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json';
    const inputs = [
      ['date', true, false, '2026-11-24', '2026-11-25'],
      ['time', false, true, '12:30', '13:45'],
      ['combined', true, true, '2026-11-24T12:30:00', '2026-11-24T13:45:00'],
    ];
    await receive({createSurface: {
      surfaceId: 'date_time', catalogId,
      dataModel: Object.fromEntries(inputs.map(([id, , , value]) => [id, value])),
      components: [
        {id: 'root', component: 'Column', children: inputs.map(([id]) => id)},
        ...inputs.map(([id, enableDate, enableTime]) => ({
          id, component: 'DateTimeInput', label: id, enableDate, enableTime, value: {'@path': `/${id}`},
        })),
      ],
    }});
    const read = id => page.evaluate(id => document.querySelector('a2ui-surface').surface.dataModel.get(`/${id}`), id);
    for (const [id, , enableTime, initialValue, editedValue] of inputs) {
      const labeled = page.getByLabel(id, {exact: true});
      const control = labeled.and(page.locator(`input[type=${enableTime ? 'time' : 'date'}]`));
      const nativeValue = value => id === 'combined' ? value.slice(11, 16) : value;
      assert.equal(await control.inputValue(), nativeValue(initialValue));
      await control.fill(nativeValue(editedValue));
      assert.equal(await read(id), editedValue);
      await control.fill('');
      assert.equal(await read(id), '');
      if (id === 'combined') {
        const date = labeled.and(page.locator('input[type=date]'));
        assert.equal(await date.inputValue(), '');
        await control.fill('09:15');
        assert.match(await read(id), /^\d{4}-\d{2}-\d{2}T09:15:00$/);
        await date.fill('');
        assert.equal(await read(id), '');
        assert.equal(await control.inputValue(), '');
      }
    }
    assert.deepEqual(await page.evaluate(() => window.fixture.outbound), []);
    await page.close();
  });
});

test('independent Three.js projections keep native choice selection and model writes isolated', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage({viewport: {width: 1200, height: 800}});
    page.setDefaultTimeout(4500);
    await page.goto(origin + '/test-support/fixture-host.html');
    await page.evaluate(catalogId => {
      const first = document.querySelector('#viewport');
      const second = document.createElement('section');
      second.id = 'second';
      for (const viewport of [first, second]) {
        Object.assign(viewport.style, {
          position: 'relative', width: '50%', height: '100vh', display: 'inline-block', verticalAlign: 'top',
        });
      }
      first.after(second);
      const projection = window.fixture.mount(undefined, second);
      for (const [index, renderer] of [window.fixture.projection, projection].entries()) {
        renderer.receive({version: '1.0', createSurface: {
          surfaceId: 'session', catalogId,
          dataModel: {selected: [index === 0 ? 'a' : 'b']},
          components: [{
            id: 'root', component: 'ChoicePicker', label: 'Measure',
            value: {'@path': '/selected'}, options: [{value: 'a', label: 'Amplitude'}, {value: 'b', label: 'Phase'}],
          }],
        }});
      }
    }, basicCatalog.id);
    const first = page.locator('#viewport');
    const second = page.locator('#second');
    const firstAmplitude = first.getByRole('radio', {name: 'Amplitude'});
    const firstPhase = first.getByRole('radio', {name: 'Phase'});
    const secondPhase = second.getByRole('radio', {name: 'Phase'});
    await secondPhase.waitFor();
    assert.equal(await firstAmplitude.isChecked(), true);
    assert.equal(await secondPhase.isChecked(), true);
    await firstAmplitude.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await firstPhase.isChecked(), true);
    assert.equal(await firstAmplitude.isChecked(), false);
    assert.equal(await secondPhase.isChecked(), true);
    await second.getByRole('radio', {name: 'Amplitude'}).check();
    assert.equal(await firstPhase.isChecked(), true);
    assert.equal(await secondPhase.isChecked(), false);
    const snapshots = await page.evaluate(() => [...document.querySelectorAll('a2ui-surface')]
      .map(view => view.surface.dataModel.get('/selected')));
    assert.deepEqual(snapshots, [['b'], ['a']]);
    assert.deepEqual(await page.evaluate(() => window.fixture.outbound), []);
    await page.close();
  });
});

test('Basic Catalog choice controls apply their selection mode when options are filtered', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage({viewport: {width: 1000, height: 800}});
    page.setDefaultTimeout(4500);
    await page.goto(origin + '/test-support/fixture-host.html');
    const options = [{value: 'a', label: 'Amplitude'}, {value: 'b', label: 'Phase'}];
    await page.evaluate(({catalogId, options}) => window.fixture.projection.receive({version: '1.0', createSurface: {
      surfaceId: 'choices', catalogId, dataModel: {multiple: [], single: []},
      components: [
        {id: 'root', component: 'Column', children: ['multiple', 'single']},
        {id: 'multiple', component: 'ChoicePicker', label: 'Measures', variant: 'multipleSelection',
          filterable: true, value: {'@path': '/multiple'}, options},
        {id: 'single', component: 'ChoicePicker', label: 'Primary measure', displayStyle: 'chips',
          value: {'@path': '/single'}, options},
      ],
    }}), {catalogId: basicCatalog.id, options});
    const read = () => page.evaluate(() => document.querySelector('a2ui-surface').surface.dataModel.get('/'));
    const measures = page.getByRole('group', {name: 'Measures', exact: true});
    const filter = page.getByRole('textbox', {name: 'Filter options'});
    await measures.getByRole('checkbox', {name: 'Amplitude'}).check();
    await filter.fill('phase');
    const amplitude = measures.getByRole('checkbox', {name: 'Amplitude'});
    assert.equal(await amplitude.count(), 0);
    assert.deepEqual(await read(), {multiple: ['a'], single: []});
    await measures.getByRole('checkbox', {name: 'Phase'}).check();
    assert.deepEqual(await read(), {multiple: ['a', 'b'], single: []});
    await filter.fill('');
    assert.equal(await amplitude.isChecked(), true);
    await amplitude.uncheck();

    const primary = page.getByRole('group', {name: 'Primary measure'});
    const amplitudeChip = primary.getByRole('button', {name: 'Amplitude'});
    const phaseChip = primary.getByRole('button', {name: 'Phase'});
    await amplitudeChip.click();
    assert.equal(await amplitudeChip.getAttribute('aria-pressed'), 'true');
    await phaseChip.click();
    assert.equal(await amplitudeChip.getAttribute('aria-pressed'), 'false');
    assert.equal(await phaseChip.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await read(), {multiple: ['b'], single: ['b']});
    assert.deepEqual(await page.evaluate(() => window.fixture.outbound), []);
    await page.close();
  });
});

test('Basic Catalog text field variants expose their native controls and bind strings in both directions', async () => {
  const fields = [
    {id: 'default', label: 'Short text', tag: 'INPUT', type: 'text', initial: 'Initial', edited: 'Updated'},
    {id: 'long', label: 'Long text', variant: 'longText', tag: 'TEXTAREA', type: 'textarea',
      initial: 'Line one', edited: 'Line one\nLine two'},
    {id: 'number', label: 'Numeric text', variant: 'number', tag: 'INPUT', type: 'number',
      initial: '5', edited: '12.5'},
    {id: 'obscured', label: 'Obscured text', variant: 'obscured', tag: 'INPUT', type: 'password',
      initial: '', edited: 'fixture-only'},
  ];
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage({viewport: {width: 1000, height: 800}});
    page.setDefaultTimeout(4500);
    await page.goto(origin + '/test-support/fixture-host.html');
    const receive = body => page.evaluate(body => window.fixture.projection.receive({version: '1.0', ...body}), body);
    await receive({createSurface: {
      surfaceId: 'fields', catalogId: basicCatalog.id,
      dataModel: {prompt: 'Enter a value', ...Object.fromEntries(fields.map(({id, initial}) => [id, initial]))},
      components: [
        {id: 'root', component: 'Column', children: fields.map(({id}) => id)},
        ...fields.map(({id, label, variant}) => ({
          id, label, ...(variant && {variant}), component: 'TextField',
          value: {'@path': `/${id}`}, placeholder: {'@path': '/prompt'},
        })),
      ],
    }});
    const read = id => page.evaluate(id => document.querySelector('a2ui-surface').surface.dataModel.get(`/${id}`), id);
    const replacement = {default: 'Agent text', long: 'Agent\ntext', number: '7', obscured: ''};
    for (const {id, label, tag, type, initial, edited} of fields) {
      const control = page.getByLabel(label, {exact: true});
      assert.deepEqual(await control.evaluate(el => [el.tagName, el.type, el.placeholder, el.value]),
        [tag, type, 'Enter a value', initial]);
      await control.fill(edited);
      assert.equal(await read(id), edited);
      await receive({updateDataModel: {surfaceId: 'fields', path: `/${id}`, value: replacement[id]}});
      await page.waitForFunction(({label, expected}) => [...document.querySelectorAll('a2ui-surface label')]
        .find(element => element.textContent === label)?.control?.value === expected,
      {label, expected: replacement[id]});
    }
    assert.deepEqual(await page.evaluate(() => window.fixture.outbound), []);
    await page.close();
  });
});

test('Basic Catalog lists change layout direction while preserving the ordered items', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage({viewport: {width: 1000, height: 800}});
    page.setDefaultTimeout(4500);
    await page.goto(origin + '/test-support/fixture-host.html');
    const receive = body => page.evaluate(body => window.fixture.projection.receive({version: '1.0', ...body}), body);
    const root = {id: 'root', component: 'List', children: ['first', 'second'],
      accessibility: {label: 'Measurements'}};
    await receive({createSurface: {
      surfaceId: 'list', catalogId: basicCatalog.id,
      components: [
        root,
        {id: 'first', component: 'Text', text: 'Amplitude'},
        {id: 'second', component: 'Text', text: 'Phase'},
      ],
    }});
    const list = page.getByRole('list', {name: 'Measurements'});
    const first = list.getByText('Amplitude', {exact: true});
    const second = list.getByText('Phase', {exact: true});
    const original = await first.elementHandle();
    const measure = async () => {
      const [a, b] = await Promise.all([first.boundingBox(), second.boundingBox()]);
      return {across: b.x - a.x, down: b.y - a.y};
    };
    assert.deepEqual((await list.getByRole('listitem').allTextContents()).map(value => value.trim()), ['Amplitude', 'Phase']);
    const vertical = await measure();
    assert.ok(Math.abs(vertical.across) < 1 && vertical.down > 1, JSON.stringify(vertical));
    await receive({updateComponents: {surfaceId: 'list', components: [{...root, direction: 'horizontal'}]}});
    const horizontal = await measure();
    assert.ok(horizontal.across > 1 && Math.abs(horizontal.down) < 1, JSON.stringify(horizontal));
    assert.equal(await first.evaluate((current, previous) => current === previous, original), true);
    assert.deepEqual(await page.evaluate(() => window.fixture.outbound), []);
    await page.close();
  });
});

test('metadata snapshots and notifications are independent from mounted component properties', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    page.setDefaultTimeout(4500);
    await page.goto(origin + '/test-support/fixture-host.html');
    const surfaceId = 'metadata';
    const text = {id: 'root', component: 'Text', text: 'Visible'};
    await page.evaluate(createSurface => window.fixture.projection.receive({version: '1.0', createSurface}),
      {surfaceId, catalogId: basicCatalog.id, components: [text]});
    await page.getByText(text.text, {exact: true}).waitFor();
    const outcome = await page.evaluate(async ({surfaceId, text}) => {
      const {fixture} = window;
      const receive = (type, value) => fixture.projection.receive({
        version: '1.0', [type]: {surfaceId, ...value},
      });
      const view = document.querySelector('a2ui-surface');
      const findRoot = () => [...view.querySelectorAll('*')].find(child => child.node === view.rootNode);
      const element = findRoot();
      await element.updateComplete;
      const pendingUpdate = element.updateComplete;
      const component = view.surface.componentsModel.get('root');
      const after = {};
      for (const [name, model] of [['surface', view.surface], ['component', component]]) {
        const changes = [];
        const subscription = model.onMetadataChanged.subscribe(metadata => changes.push(metadata ?? null));
        const input = {extensions: {example_source: {revision: 1}}};
        model.metadata = input;
        const original = model.metadata;
        input.extensions.example_source.revision = 11;
        model.metadata = {extensions: {example_source: {revision: 1}}};
        let invalidRejected = false;
        try {
          model.setExtension('invalid-name', 3);
        } catch {
          invalidRejected = true;
        }
        model.setExtension('example_source', null);
        model.removeExtension('example_source');
        model.removeExtension('example_source');
        subscription.unsubscribe();
        after[name] = {original, invalidRejected, changes, removed: model.metadata === undefined,
          frozen: Object.isFrozen(original.extensions.example_source)};
      }
      const listen = [];
      component.onMetadataChanged.subscribe(metadata => listen.push(metadata ?? null));
      const external = {extensions: {example_source: 'agent'}};
      receive('updateComponents', {components: [{...text, '@metadata': external}]});
      const wireExtension = fixture.metadata(view.rootNode);
      receive('updateComponents', {components: [text]});
      after.wire = {wireExtension, notices: listen, removed: fixture.metadata(view.rootNode) === undefined};
      after.view = {
        sameElement: element === findRoot(),
        updateRequested: pendingUpdate !== element.updateComplete,
        text: element.textContent.trim(),
      };
      after.outbound = fixture.outbound;
      return after;
    }, {surfaceId, text});
    for (const key of ['surface', 'component']) {
      const original = {extensions: {example_source: {revision: 1}}};
      assert.deepEqual(outcome[key], {
        original, invalidRejected: true, frozen: true, removed: true,
        changes: [original, {extensions: {example_source: null}}, null],
      });
    }
    const wireExtension = {extensions: {example_source: 'agent'}};
    assert.deepEqual(outcome.wire, {wireExtension, notices: [wireExtension, null], removed: true});
    assert.deepEqual(outcome.view, {sameElement: true, updateRequested: false, text: 'Visible'});
    assert.deepEqual(outcome.outbound, []);
    await page.close();
  });
});
