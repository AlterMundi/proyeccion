import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {createRequire} from 'node:module';
import {parse} from 'yaml';
import {assertComponent} from '../test-support/accessibility.js';
import {withBrowser} from '../test-support/browser.js';
import {record} from '../test-support/conformance-manifest.js';

const fixture = new URL('./fixtures/a2ui-v1/accessibility.yaml', import.meta.url);
const cases = parse(readFileSync(fixture, 'utf8'));
const axeScript = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

const suite = 'core/accessibility.yaml';

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
