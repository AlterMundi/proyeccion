import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {parse} from 'yaml';
import {withBrowser} from '../test-support/browser.js';
import {record} from '../test-support/conformance-manifest.js';
import {createProtocol} from '../src/protocol.js';

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
]);

async function assertViewTree(page, expected) {
  const actual = await page.evaluate(expected => {
    const component = host => host.context?.componentModel;
    const childComponents = host => [...host.querySelectorAll('*')].filter(child => {
      if (!component(child)) return false;
      for (let current = child.parentElement; current && current !== host; current = current.parentElement) {
        if (component(current)) return false;
      }
      return true;
    });
    function nativeValue(element, value) {
      const input = element.querySelector('input:not([type="hidden"]), textarea');
      if (Array.isArray(value)) {
        return [...element.querySelectorAll('input:checked')].map(option => option.value);
      }
      if (input?.type === 'checkbox') return input.checked;
      if (input?.type === 'range') return input.valueAsNumber;
      const time = element.querySelector('input[type="time"]');
      if (input?.type === 'date' && time) {
        const minutes = time.value;
        return input.value + 'T' + (minutes.length === 5 ? minutes + ':00' : minutes);
      }
      return input?.value;
    }
    const read = (element, shape) => {
      const props = {};
      for (const [key, value] of Object.entries(shape ?? {})) {
        switch (key) {
          case 'id': props.id = component(element)?.id; break;
          case 'type': props.type = component(element)?.type; break;
          case 'text': props.text = element.textContent.trim(); break;
          case 'url': props.url = element.querySelector('img, video, audio')?.getAttribute('src'); break;
          case 'name': props.name = element.querySelector('i')?.textContent.trim(); break;
          case 'axis': props.axis = element.querySelector('[role="separator"], hr')?.getAttribute('aria-orientation') ?? 'horizontal'; break;
          case 'value': props.value = nativeValue(element, value); break;
          case 'state': props.state = element.node?.state; break;
          case 'children': {
            const children = childComponents(element);
            const pending = window.fixture.pendingChildren(element.node);
            let index = 0;
            props.children = value.map(shape => {
              if (shape.state === 'pending') {
                const node = pending.find(child => child.componentId === shape.id);
                if (node) return {id: node.componentId, state: node.state};
                return {missingPending: shape.id};
              }
              const child = children[index++];
              return child ? read(child, shape) : {missing: shape.id};
            });
            for (const extra of children.slice(index)) {
              props.children.push({unexpectedChild: component(extra)?.id});
            }
            break;
          }
          default: throw new Error('Unsupported fixture field: ' + key);
        }
      }
      return shape ? props : {unexpectedChild: component(element)?.id};
    };
    const host = document.querySelector('a2ui-surface');
    const root = host && childComponents(host).find(node => component(node).id === expected.id);
    return root && read(root, expected);
  }, expected);
  assert.deepEqual(actual, expected);
}

async function userInput(page, step) {
  const value = step.inputValue;
  if (step.targetNode === 'root') {
    await page.getByRole('tab').nth(value).click();
    return;
  }
  await page.evaluate(() => window.fixture.markInputs());
  const component = page.locator('[data-fixture-component="' + step.targetNode + '"]');
  if (typeof value === 'boolean') {
    await component.getByRole('checkbox').setChecked(value);
  } else if (Array.isArray(value)) {
    for (const selection of value) await component.locator('input[value="' + selection + '"]').check();
  } else if (typeof value === 'number') {
    await component.getByRole('slider').fill(String(value));
  } else if (await component.locator('input[type="date"]').count()) {
    const [date, time] = value.split('T');
    await component.locator('input[type="date"]').fill(date);
    if (time) await component.locator('input[type="time"]').fill(time.slice(0, 5));
  } else {
    await component.getByRole('textbox').fill(value);
  }
}

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
        record(suite, entry.name, 'skipped', 'This browser harness has not implemented all assertions and operations for this case.');
        continue;
      }
      await t.test(entry.name, async () => {
        let page;
        try {
          assert.equal(entry.protocolVersion, '1.0');
          assert.equal(entry.action, 'render_surface');
          page = await browser.newPage({viewport: {width: 1000, height: 800}});
          page.setDefaultTimeout(4500);
          await page.route('https://example.com/**', route => route.abort());
          await page.goto(origin + '/test-support/fixture-host.html');
          for (const step of entry.steps) {
            await page.evaluate(() => window.fixture.snapshot());
            if (step.op === 'process_messages') {
              await page.evaluate(messages => {
                for (const message of messages) window.fixture.projection.receive(message);
              }, step.messages);
              if (step.expectSurfaceRemoved) {
                await page.locator('a2ui-surface').waitFor({state: 'detached'});
              } else {
                await page.waitForFunction(() => document.querySelector('a2ui-surface')?.rootNode);
              }
            } else if (step.op === 'user_input') {
              await userInput(page, step);
            } else if (step.op === 'unmount_surface') {
              await page.locator('a2ui-surface').evaluate(element => element.remove());
            } else if (step.op === 'user_gesture' && entry.name === 'modal_open_shows_content') {
              await page.getByRole('button', {name: 'Open Details'}).click();
              await page.getByRole('dialog').waitFor();
            } else {
              throw new Error('Unsupported fixture operation: ' + step.op);
            }
            if (step.expectViewTree) await assertViewTree(page, step.expectViewTree);
            if (step.expectDataModel) {
              const model = await page.evaluate(() => document.querySelector('a2ui-surface').surface.dataModel.get('/'));
              assert.deepEqual(model, step.expectDataModel);
            }
            if (step.expectActions || step.expectOutbound) {
              const messages = await page.evaluate(() => window.fixture.outbound.splice(0).map(row => row.message));
              if (step.expectOutbound) assert.deepEqual(messages, step.expectOutbound);
              if (step.expectActions) {
                assert.deepEqual(messages.map(({action}) => {
                  const {timestamp, ...data} = action;
                  assert.ok(Number.isFinite(Date.parse(timestamp)));
                  return data;
                }), step.expectActions);
              }
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
              'expectActiveSubscriptions'];
            assert.deepEqual(Object.keys(step).filter(key => key.startsWith('expect') && !accepted.includes(key)), []);
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
          record(suite, entry.name, 'passed');
        } catch (error) {
          record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
          throw error;
        } finally {
          await page?.close();
        }
      });
    }
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

test('A2UI media controls decode and play local synthetic audio and video', {timeout: 15000}, async () => {
  const create = cases.find(entry => entry.name === 'media_components_bind_url_and_name')
    .steps[0].messages[0];
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.route('https://example.com/**', route => route.abort());
    await page.goto(origin + '/test-support/fixture-host.html');
    await page.evaluate(({message, origin}) => {
      const {createSurface} = message;
      createSurface.dataModel.media.audioUrl = origin + '/test/fixtures/media/tone.wav';
      createSurface.dataModel.media.videoUrl = origin + '/test/fixtures/media/pattern.webm';
      window.fixture.projection.receive(message);
    }, {message: create, origin});
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
