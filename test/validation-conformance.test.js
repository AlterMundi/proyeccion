import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {parse} from 'yaml';
import {basicCatalog} from '../src/protocol.js';
import {withBrowser} from '../test-support/browser.js';
import {record} from '../test-support/conformance-manifest.js';
import {assertWireMessage} from '../test-support/wire-check.js';

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

test('only validation of the current value can release a pending button action', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    try {
      await page.goto(origin + '/test-support/fixture-host.html');
      await page.evaluate(catalogId => {
        const value = {'@path': '/level'};
        const checks = [{condition: {'@call': 'checkLevel', args: {value}}}];
        window.fixture.projection.receive({version: '1.0', createSurface: {
          surfaceId: 'pending_check', catalogId, dataModel: {level: 'Original'},
          components: [
            {id: 'root', component: 'Column', children: ['entry', 'apply']},
            {id: 'entry', component: 'TextField', label: 'Level', value, '@checks': checks},
            {id: 'apply', component: 'Button', child: 'label', '@checks': checks,
              action: {event: {name: 'applyLevel', context: {value}}}},
            {id: 'label', component: 'Text', text: 'Apply level'},
          ],
        }});
      }, basicCatalog.id);
      const field = page.getByRole('textbox', {name: 'Level'});
      const button = page.getByRole('button', {name: 'Apply level'});
      await button.waitFor({timeout: 4000});
      const calls = async () => {
        await page.waitForFunction(() => window.fixture.outbound.length === 1, undefined, {timeout: 4000});
        return page.evaluate(() => window.fixture.outbound.shift().message.callAgentFunction);
      };
      const reply = (call, value) => page.evaluate(({functionCallId, value}) => window.fixture.projection.receive({
        version: '1.0', agentFunctionResponse: {functionCallId, value},
      }), {functionCallId: call.functionCallId, value});
      const original = await calls();
      assert.deepEqual(original.callFunction.args, {value: 'Original'});
      assert.equal(await button.isDisabled(), true);
      await reply(original, {valid: false, message: 'Original level rejected'});
      await page.getByText('Original level rejected', {exact: true}).waitFor({timeout: 4000});

      await field.fill('Intermediate');
      const intermediate = await calls();
      assert.deepEqual(intermediate.callFunction.args, {value: 'Intermediate'});
      await field.fill('Latest');
      const latest = await calls();
      assert.deepEqual(latest.callFunction.args, {value: 'Latest'});
      assert.equal(await button.isDisabled(), true);
      const bounds = await button.boundingBox();
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
      assert.deepEqual(await page.evaluate(() => window.fixture.outbound), []);
      await page.getByText('Original level rejected', {exact: true}).waitFor({timeout: 4000});

      await reply(latest, {valid: true});
      await page.waitForFunction(() => !document.querySelector('a2ui-surface button').disabled);
      await reply(intermediate, {valid: false, message: 'Outdated level rejected'});
      assert.equal(await button.isDisabled(), false);
      assert.equal(await page.getByText('Outdated level rejected', {exact: true}).count(), 0);
      await button.click();
      const sent = await page.evaluate(() => window.fixture.outbound.shift());
      assert.equal(sent.message.action.name, 'applyLevel');
      assert.deepEqual(sent.message.action.context, {value: 'Latest'});
      await field.fill('After approval');
      const afterApproval = await calls();
      assert.deepEqual(afterApproval.callFunction.args, {value: 'After approval'});
      assert.equal(await button.isDisabled(), true);
      await reply(afterApproval, {valid: false, severity: 'warning', message: 'Review the level'});
      await page.waitForFunction(() => !document.querySelector('a2ui-surface button').disabled);
      assert.deepEqual(await page.evaluate(() => window.fixture.outbound), []);
    } finally {
      await page.close();
    }
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('DynamicBoolean follows the 1.0 coercion table in controls and logical checks', async () => {
  const probeCatalog = 'fixture-boolean-probe';
  const cases = [
    ['boolean true', true, true], ['boolean false', false, false],
    ['valid finding', {valid: true, code: 'CLEAN'}, true],
    ['invalid finding', {valid: false, severity: 'warning'}, false],
    ['true string', 'TrUe', true], ['false string', 'FaLsE', false],
    ['other string', 'yes', false], ['empty string', '', false],
    ['zero', 0, false], ['positive number', 2, true], ['negative number', -2, true],
    ['null', null, false], ['absent', undefined, false],
    ['other object', {valid: 'true'}, false], ['array', [true], false],
  ];
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    try {
      await page.goto(origin + '/test-support/fixture-host.html');
      await page.evaluate(({catalogId, probeCatalog}) => {
        window.fixture.addBooleanProbeCatalog(probeCatalog);
        const value = {'@path': '/probe'};
        const and = {'@call': 'and', args: {values: [true, value]}};
        const or = {'@call': 'or', args: {values: [false, value]}};
        const not = {'@call': 'not', args: {value: or}};
        window.fixture.projection.receive({version: '1.0', createSurface: {
          surfaceId: 'dynamic_boolean', catalogId,
          components: [
            {id: 'root', component: 'Column', children: ['raw', 'and', 'or', 'apply']},
            {id: 'raw', component: 'CheckBox', label: 'Bound value', value},
            {id: 'and', component: 'CheckBox', label: 'And result', value: and},
            {id: 'or', component: 'CheckBox', label: 'Or result', value: or},
            {id: 'apply', component: 'Button', child: 'label', '@checks': [{condition: not, message: 'Expected false'}],
              action: {event: {name: 'apply'}}},
            {id: 'label', component: 'Text', text: 'Apply when false'},
          ],
        }});
      }, {catalogId: basicCatalog.id, probeCatalog});
      const button = page.getByRole('button', {name: 'Apply when false'});
      await button.waitFor({timeout: 4000});
      for (const [index, [name, value, expected]] of cases.entries()) {
        await page.evaluate(dataModel => window.fixture.projection.receive({version: '1.0', updateDataModel: {
          surfaceId: 'dynamic_boolean', value: dataModel,
        }}), value === undefined ? {} : {probe: value});
        for (const label of ['Bound value', 'And result', 'Or result']) {
          assert.equal(await page.getByRole('checkbox', {name: label}).isChecked(), expected, name + ' — ' + label);
        }
        assert.equal(await button.isDisabled(), expected, name + ' — negated check');
        const functionCallId = 'boolean_' + index;
        const responses = await page.evaluate(async ({functionCallId, probeCatalog}) => {
          await window.fixture.projection.receive({version: '1.0', callRendererFunction: {
            functionCallId, surfaceId: 'dynamic_boolean',
            callFunction: {'@call': 'inspectBooleans', catalogId: probeCatalog,
              args: {values: [{'@path': '/probe'}, true]}},
          }});
          return window.fixture.outbound.splice(0);
        }, {functionCallId, probeCatalog});
        assert.equal(responses.length, 1, name + ' — catalog call');
        assertWireMessage(responses[0].message, responses[0].metadata);
        assert.deepEqual(responses[0].message.rendererFunctionResponse, {
          functionCallId, value: 'boolean:' + expected + ',boolean:true',
        }, name + ' — catalog call');
      }
      const invalid = await page.evaluate(async probeCatalog => {
        const {fixture} = window;
        await fixture.projection.receive({version: '1.0', callRendererFunction: {
          functionCallId: 'invalid_boolean', surfaceId: 'dynamic_boolean',
          callFunction: {'@call': 'inspectBooleans', catalogId: probeCatalog, args: {values: [
            'true', {'@call': 'inspectBooleans', catalogId: probeCatalog, args: {values: [true]}},
          ]}},
        }});
        return {responses: fixture.outbound, failures: fixture.failures, executed: fixture.booleanProbeCalls};
      }, probeCatalog);
      assert.equal(invalid.executed, cases.length);
      assert.deepEqual(invalid.failures, []);
      assert.equal(invalid.responses.length, 1);
      assertWireMessage(invalid.responses[0].message, invalid.responses[0].metadata);
      const rejected = invalid.responses[0].message.rendererFunctionResponse;
      assert.equal(rejected.functionCallId, 'invalid_boolean');
      assert.equal(rejected.error.code, 'INVALID_FUNCTION_CALL');
      assert.match(rejected.error.message, /DynamicBoolean/);
    } finally {
      await page.close();
    }
  }, process.env.PROYECCION_BROWSER_PROJECT);
});
