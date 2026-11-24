import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {parse} from 'yaml';
import {basicCatalog} from '../src/protocol.js';
import {withBrowser} from '../test-support/browser.js';
import {record} from '../test-support/conformance-manifest.js';

const suite = 'adapter/markdown_subset.yaml';
const entries = parse(readFileSync(new URL('./fixtures/a2ui-v1/markdown_subset.yaml', import.meta.url), 'utf8'));
const elements = {
  emphasis: 'em, i', strong: 'strong, b', heading: 'h1, h2, h3, h4, h5, h6',
  list_item: 'li', code: 'code', html: 'p span, script, iframe', image: 'img', link: 'a',
};

test('Basic Catalog Markdown subset on a mounted Three.js surface', {timeout: 30000}, async t => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    page.setDefaultTimeout(3000);
    const external = [];
    try {
      await page.route('https://example.com/**', route => {
        external.push(route.request().url());
        return route.abort();
      });
      await page.goto(origin + '/test-support/fixture-host.html');
      const view = page.locator('a2ui-surface');
      for (const entry of entries) {
        await t.test(entry.name, async () => {
          try {
            await page.evaluate(({catalogId, text}) => window.fixture.projection.receive({
              version: '1.0', createSurface: {surfaceId: 'help', catalogId,
                components: [{id: 'root', component: 'Text', text}]},
            }), {catalogId: basicCatalog.id, text: entry.markdown});
            await page.waitForFunction(() => document.querySelector('a2ui-surface p, a2ui-surface h1, a2ui-surface li'));
            const text = await view.textContent();
            assert.equal(text.replace(/\s+/g, ' ').trim(), entry.expectVisibleText);
            for (const type of entry.expectPresent) assert.ok(await view.locator(elements[type]).count(), type);
            for (const type of entry.expectAbsent) assert.equal(await view.locator(elements[type]).count(), 0, type);
            assert.deepEqual(external, []);
            assert.deepEqual(await page.evaluate(() => window.fixture.outbound), []);
            record(suite, entry.name, 'passed');
          } catch (error) {
            record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
            throw error;
          } finally {
            await page.evaluate(() => window.fixture.projection.receive({
              version: '1.0', deleteSurface: {surfaceId: 'help'},
            }));
            await view.waitFor({state: 'detached'});
          }
        });
      }
    } finally {
      await page.close();
    }
  });
});
