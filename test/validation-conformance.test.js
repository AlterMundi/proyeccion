import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {parse} from 'yaml';
import {basicCatalog} from '../src/protocol.js';
import {withBrowser} from '../test-support/browser.js';
import {record} from '../test-support/conformance-manifest.js';

const suite = 'core/validation_result.yaml';
const messagePrecedence = new Map([
  ['test_validation_result_boolean_fallback', new Map([
    ['Must be 18 or older.', 'Minimum value is 18.'],
  ])],
  ['test_validation_result_multiple_rules_preserve_order', new Map([
    ['Must be a valid email address.', 'Please enter a valid email address (e.g. user@example.com).'],
    ['Email must be at least 10 characters.', 'Minimum length is 10.'],
  ])],
]);
const entries = parse(readFileSync(new URL('./fixtures/a2ui-v1/validation_result.yaml', import.meta.url), 'utf8'));

test('pinned validation results on mounted controls', {timeout: 30000}, async t => {
  await withBrowser(async (browser, origin) => {
    for (const entry of entries) {
      const corrections = messagePrecedence.get(entry.name);
      await t.test(corrections ? entry.name + ' (specification message precedence)' : entry.name, async () => {
        const page = await browser.newPage();
        try {
          await page.goto(origin + '/test-support/fixture-host.html');
          for (const step of entry.steps) {
            // The fixture's `basic` ID refers to the local Basic Catalog.
            await page.evaluate(({payload, catalogId}) => {
              for (const item of payload) {
                const message = item.createSurface?.catalogId === 'basic'
                  ? {...item, createSurface: {...item.createSurface, catalogId}} : item;
                window.fixture.projection.receive(message);
              }
            }, {payload: step.payload, catalogId: basicCatalog.id});
            const {form_surface: expected} = (step.expect ?? entry.expect).surfaces;
            const canonicalMessage = value => corrections?.get(value) ?? value;
            await page.locator('a2ui-surface .a2ui-textfield').first().waitFor({state: 'visible'});
            const actual = await page.evaluate(ids => {
              const hosts = [...document.querySelectorAll('a2ui-surface *')];
              return Object.fromEntries(ids.map(id => {
                const host = hosts.find(element => element.node?.componentId === id);
                const props = window.fixture.props(host.node);
                const input = host.querySelector('.a2ui-textfield');
                return [id, {
                  isValid: props.isValid,
                  invalidAttribute: input.getAttribute('aria-invalid'),
                  validationErrors: props.validationErrors,
                  validationResults: props.validationResults,
                  visibleErrors: [...host.querySelectorAll('.a2ui-error-message')]
                    .map(element => element.textContent.trim()),
                  hints: [...host.querySelectorAll('.proyeccion-validation-hint')]
                    .map(element => element.textContent.trim()),
                }];
              }));
            }, Object.keys(expected.isValid));
            for (const [id, isValid] of Object.entries(expected.isValid)) {
              const observed = actual[id];
              assert.equal(observed.isValid, isValid, id);
              assert.equal(observed.invalidAttribute, isValid ? null : 'true', id);
              const errors = expected.validationErrors[id].map(canonicalMessage);
              assert.deepEqual(observed.validationErrors, errors, id);
              assert.deepEqual(observed.validationResults, expected.validationResults[id].map(result => ({
                ...result, message: canonicalMessage(result.message),
              })), id);
              assert.deepEqual(observed.visibleErrors, errors, id);
              assert.deepEqual(observed.hints, expected.validationResults[id]
                .filter(result => result.severity !== 'error').map(result => result.message), id);
              if (expected.validationResult?.[id]) {
                for (const [key, value] of Object.entries(expected.validationResult[id])) {
                  assert.equal(observed.validationResults[0][key], key === 'message' ? canonicalMessage(value) : value, id + '.' + key);
                }
              }
            }
            assert.deepEqual(await page.evaluate(() => window.fixture.outbound), []);
          }
          if (corrections) {
            record(suite, entry.name, 'skipped',
              'The upstream fixture expects rule text to override a returned message. The separate browser check follows protocol § Component Validation & Check Rules.');
          } else {
            record(suite, entry.name, 'passed');
          }
        } catch (error) {
          record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
          throw error;
        } finally {
          await page.close();
        }
      });
    }
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('correcting a field re-enables its validated action and sends the corrected value once', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    try {
      await page.goto(origin + '/test-support/fixture-host.html');
      await page.evaluate(catalogId => {
        const email = {'@path': '/email'};
        const checks = [{condition: {'@call': 'email', args: {value: email}}}];
        window.fixture.projection.receive({version: '1.0', createSurface: {
          surfaceId: 'form', catalogId, dataModel: {email: 'bad'},
          components: [
            {id: 'root', component: 'Column', children: ['email', 'submit']},
            {id: 'email', component: 'TextField', label: 'Email', value: email, '@checks': checks},
            {id: 'submit', component: 'Button', child: 'label', '@checks': checks,
              action: {event: {name: 'submitEmail', context: {email}}}},
            {id: 'label', component: 'Text', text: 'Submit'},
          ],
        }});
      }, basicCatalog.id);
      const input = page.getByRole('textbox', {name: 'Email'});
      const submit = page.getByRole('button', {name: 'Submit'});
      await input.waitFor({state: 'visible'});
      assert.equal(await input.getAttribute('aria-invalid'), 'true');
      assert.equal(await submit.isDisabled(), true);
      assert.deepEqual(await page.evaluate(() => window.fixture.outbound), []);
      await input.fill('user@example.com');
      await submit.click();
      assert.equal(await input.getAttribute('aria-invalid'), null);
      assert.equal(await submit.isDisabled(), false);
      const sent = await page.evaluate(() => window.fixture.outbound);
      assert.equal(sent.length, 1);
      const {timestamp, ...action} = sent[0].message.action;
      assert.ok(Number.isFinite(Date.parse(timestamp)));
      assert.deepEqual(action, {
        name: 'submitEmail', surfaceId: 'form', sourceComponentId: 'submit', context: {email: 'user@example.com'},
      });
    } finally {
      await page.close();
    }
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('a remote check failure shows the error text only if the rule omits its message', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    try {
      await page.goto(origin + '/test-support/fixture-host.html');
      await page.evaluate(catalogId => {
        const fields = [
          {id: 'automatic', text: 'Automatic'},
          {id: 'custom', text: 'Custom', message: 'Please try again later.'},
          {id: 'default_text', text: 'Explicit fallback', message: 'Validation failed'},
        ];
        window.fixture.projection.receive({version: '1.0', createSurface: {
          surfaceId: 'form', catalogId,
          components: [
            {id: 'root', component: 'Column', children: fields.map(field => field.id)},
            ...fields.map(({id, text, message}) => ({
              id, component: 'TextField', label: text, value: 'ada',
              '@checks': [{
                condition: {'@call': 'checkAvailability', args: {field: id}},
                ...(message === undefined ? {} : {message}),
              }],
            })),
          ],
        }});
      }, basicCatalog.id);
      await page.waitForFunction(() => window.fixture.outbound.length === 3);
      const received = await page.evaluate(() => {
        const calls = window.fixture.outbound.splice(0).map(row => row.message.callAgentFunction);
        for (const {functionCallId} of calls) {
          window.fixture.projection.receive({version: '1.0', agentFunctionResponse: {
            functionCallId, error: {code: 'EXECUTION_ERROR', message: 'Directory service unavailable'},
          }});
        }
        return calls.map(call => call.functionCallId);
      });
      await page.getByText('Directory service unavailable', {exact: true}).waitFor({state: 'visible'});
      assert.deepEqual(await page.locator('.a2ui-error-message').allTextContents(), [
        'Directory service unavailable', 'Please try again later.', 'Validation failed',
      ]);
      const errors = await page.evaluate(() => window.fixture.outbound.map(row => row.message.error));
      assert.deepEqual(errors.map(error => error.functionCallId).sort(), received.sort());
      assert.ok(errors.every(error => error.code === 'EXPRESSION_ERROR'));
    } finally {
      await page.close();
    }
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('checks preserve domain details from bound and remote validation results', async () => {
  const bound = {valid: false, code: 'REVIEW_LEVEL', severity: 'warning', message: 'Review the level',
    fieldPaths: ['/level'], suggestedFix: {level: 0.35}};
  const remote = {valid: false, code: 'LEVEL_UNAVAILABLE', fieldPaths: ['/level'],
    retry: {afterMs: 200, reason: 'device busy'}};
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    try {
      await page.goto(origin + '/test-support/fixture-host.html');
      await page.evaluate(({bound, catalogId}) => window.fixture.projection.receive({version: '1.0', createSurface: {
        surfaceId: 'check_details', catalogId, dataModel: {finding: bound},
        components: [{id: 'root', component: 'TextField', label: 'Level', value: '0.7',
          '@checks': [
            {condition: {'@path': '/finding'}},
            {condition: {'@call': 'checkLevel', args: {}}, message: 'Try again'},
          ],
        }],
      }}), {bound, catalogId: basicCatalog.id});
      const field = page.getByRole('textbox', {name: 'Level'});
      await field.waitFor({timeout: 4000});
      const results = () => page.evaluate(() => {
        const {rootNode} = document.querySelector('a2ui-surface');
        return window.fixture.props(rootNode).validationResults;
      });
      await page.waitForFunction(() => window.fixture.outbound.length === 1, undefined, {timeout: 4000});
      const call = await page.evaluate(() => window.fixture.outbound.shift().message.callAgentFunction);
      assert.equal(call.callFunction['@call'], 'checkLevel');
      assert.deepEqual(await results(), [bound]);
      await page.evaluate(({functionCallId, value}) => window.fixture.projection.receive({
        version: '1.0', agentFunctionResponse: {functionCallId, value},
      }), {functionCallId: call.functionCallId, value: remote});
      await page.getByText('Try again', {exact: true}).waitFor({timeout: 4000});
      assert.deepEqual(await results(), [bound, {...remote, message: 'Try again', severity: 'error'}]);
      assert.equal(await field.getAttribute('aria-invalid'), 'true');
      assert.deepEqual(await page.evaluate(() => window.fixture.outbound), []);
    } finally {
      await page.close();
    }
  }, process.env.PROYECCION_BROWSER_PROJECT);
});
