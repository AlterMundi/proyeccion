import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {parse} from 'yaml';
import {withBrowser} from '../test-support/browser.js';
import {record} from '../test-support/conformance-manifest.js';

const suite = 'core/adapter_conformance.yaml';
const cases = parse(readFileSync(new URL('./fixtures/a2ui-v1/adapter_conformance.yaml', import.meta.url), 'utf8'));
const supported = new Set([
  'tree_hierarchy_declared_order', 'single_message_v10_surface_render',
  'media_components_bind_url_and_name', 'tabs_switch_content',
  'modal_open_shows_content', 'divider_and_slider_datetime_render',
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
          case 'value': {
            const input = element.querySelector('input');
            props.value = input?.type === 'range' ? input.valueAsNumber : input?.value;
            break;
          }
          case 'children': props.children = childComponents(element).map((child, index) => read(child, value[index])); break;
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
            if (step.op === 'process_messages') {
              await page.evaluate(messages => {
                for (const message of messages) window.fixture.projection.receive(message);
              }, step.messages);
              await page.waitForFunction(() => document.querySelector('a2ui-surface')?.rootNode);
            } else if (step.op === 'user_input' && entry.name === 'tabs_switch_content') {
              await page.getByRole('tab').nth(step.inputValue).click();
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
            assert.deepEqual(
              Object.keys(step).filter(key => key.startsWith('expect')
                && !['expectViewTree', 'expectDataModel', 'expectActions', 'expectOutbound'].includes(key)), [],
            );
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
