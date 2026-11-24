import assert from 'node:assert/strict';
import {appendFileSync, mkdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {createRequire} from 'node:module';
import {parse} from 'yaml';
import {withBrowser} from '../test-support/browser.js';

const fixture = new URL('./fixtures/a2ui-v1/accessibility.yaml', import.meta.url);
const cases = parse(readFileSync(fixture, 'utf8'));
const axeScript = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

function record(name, status, reason) {
  const directory = process.env.A2UI_CONFORMANCE_MANIFEST_DIR;
  if (!directory) return;
  mkdirSync(directory, {recursive: true});
  appendFileSync(join(directory, 'proyeccion-accessibility-' + process.pid + '.jsonl'),
    JSON.stringify({harness: 'proyeccion', suite: 'core/accessibility.yaml',
      case: name, status, ...(reason ? {reason} : {})}) + '\n');
}

async function assertComponent(page, id, expected) {
  // Read schema attributes from the actual mounted widget and retain its
  // selector for separate assertions against Chromium's accessible controls.
  const element = await page.evaluate(id => {
    const host = [...document.querySelectorAll('a2ui-surface *')]
      .find(node => node.context?.componentModel.id === id);
    if (!host) return null;
    host.dataset.fixtureComponent = id;
    const control = host.querySelector('button, input, textarea, [role="radiogroup"]');
    const own = name => {
      if (host.hasAttribute(name)) return host.getAttribute(name);
      return [...host.querySelectorAll('[' + name + ']')]
        .find(node => {
          for (let current = node; current !== host; current = current.parentElement) {
            if (current.context || current.node) return false;
          }
          return !node.matches('.a2ui-filter-input, .a2ui-modal-close');
        })?.getAttribute(name);
    };
    return {
      button: control?.tagName === 'BUTTON',
      label: own('aria-label') ?? control?.textContent?.trim() ?? host.textContent?.trim(),
      description: own('aria-description'),
      live: host.getAttribute('aria-live'),
      hidden: host.getAttribute('aria-hidden'),
      checked: control?.checked,
    };
  }, id);
  assert.ok(element, 'Expected mounted component ' + id);
  for (const key of ['label', 'description', 'live', 'checked']) {
    if (expected[key] !== undefined) assert.equal(element[key], expected[key], id + '.' + key);
  }
  if (expected.hidden !== undefined) assert.equal(element.hidden, String(expected.hidden), id + '.hidden');
  const role = expected.role ?? (element.button ? 'button' : undefined);
  if (role) {
    const control = page.locator('[data-fixture-component="' + id + '"]')
      .getByRole(role, expected.label ? {name: expected.label, exact: true} : {});
    assert.equal(await control.count(), expected.hidden ? 0 : 1, id + ' browser role/name');
  }
}

test('pinned A2UI v1.0 accessibility fixtures in Chromium', {timeout: 50000}, async t => {
  await withBrowser(async (browser, origin) => {
    for (const entry of cases) {
      await t.test(entry.name, async () => {
        let page;
        try {
          assert.equal(entry.protocolVersion, '1.0');
          assert.equal(entry.action, 'accessibility_check');
          page = await browser.newPage({viewport: {width: 900, height: 700}});
          page.setDefaultTimeout(4000);
          await page.goto(origin + '/test-support/fixture-host.html');
          await page.addScriptTag({path: axeScript});
          for (const step of entry.steps ?? [entry]) {
            await page.evaluate(messages => {
              for (const message of messages) window.fixture.projection.receive(message);
            }, step.messages);
            await page.waitForFunction(() => document.querySelector('a2ui-surface')?.rootNode);
            for (const [id, expected] of Object.entries(step.assertions.accessibilityTree)) {
              await assertComponent(page, id, expected);
            }
            if (step.assertions.axeCore?.length) {
              const violations = await page.evaluate(async rules => {
                const outcome = await window.axe.run(document.querySelector('a2ui-surface'), {runOnly: rules});
                return outcome.violations.map(({id, nodes}) => ({id, nodes: nodes.map(node => node.target)}));
              }, step.assertions.axeCore);
              assert.deepEqual(violations, []);
            }
          }
          assert.deepEqual(await page.evaluate(() => window.fixture.outbound), []);
          record(entry.name, 'passed');
        } catch (error) {
          record(entry.name, 'failed', String(error.message).slice(0, 1400));
          throw error;
        } finally {
          await page?.close();
        }
      });
    }
  });
});
