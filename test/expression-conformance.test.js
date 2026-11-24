import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {A2uiExpressionError, ExpressionParser, NodeResolver, getValue} from '@a2ui/web_core';
import {parse} from 'yaml';
import {loadCatalog} from '../src/catalog.js';
import {basicCatalog, createProtocol} from '../src/protocol.js';
import {withBrowser} from '../test-support/browser.js';
import {record} from '../test-support/conformance-manifest.js';
import {assertWireMessage} from '../test-support/wire-check.js';

const basic = basicCatalog.copyWith({catalogId: 'basic'});

function assertParsed(entry) {
  const parser = new ExpressionParser();
  const error = entry.expect_error ?? entry.expectError;
  if (error) {
    assert.equal(error.category, 'ParseError');
    assert.throws(() => parser.parse(entry.input), failure =>
      failure instanceof A2uiExpressionError && new RegExp(error.message).test(failure.message));
    return;
  }
  const parts = [];
  for (const part of parser.parse(entry.input)) {
    if (part === '') continue;
    if (typeof part === 'string' && typeof parts.at(-1) === 'string') parts[parts.length - 1] += part;
    else parts.push(part);
  }
  assert.deepEqual(parts, entry.expect);
}

async function assertResolved(entry) {
  const catalog = entry.catalog.components ? loadCatalog(entry.catalog) : basic;
  const sent = [];
  const transportErrors = [];
  let resolver;
  const protocol = createProtocol({
    catalogs: [catalog],
    send: message => sent.push(message),
    onTransportError: error => transportErrors.push(error.message),
    onSurfaceCreated: surface => { resolver = new NodeResolver(surface); },
  });
  const target = entry.expect ? Object.values(entry.expect.surfaces)[0].components : undefined;
  const expectedRoot = Array.isArray(target) ? target.find(component => component.id === 'root') : target?.root;
  const error = entry.expectError ?? entry.steps?.find(step => step.expectError)?.expectError;
  try {
    for (const step of entry.steps ?? [entry]) {
      for (const message of step.payload ?? step.messages) await protocol.receive(message);
    }
    const root = resolver && getValue(resolver.rootNode);
    if (error) {
      assert.equal(error.category, 'ValidationError');
      assert.ok(sent.length > 0);
      for (const message of sent) {
        assertWireMessage(message);
        assert.equal(message.error.code, root ? 'EXPRESSION_ERROR' : 'VALIDATION_FAILED');
        assert.equal(message.error.surfaceId, root ? 'main' : 's1');
        if (error.message) assert.ok(message.error.message.includes(error.message), message.error.message);
      }
      if (root) assert.equal(getValue(root.props).text?.value ?? null, null);
    } else {
      assert.equal(root?.state, 'resolved');
      assert.deepEqual(sent, []);
      const props = getValue(root.props);
      if (expectedRoot) {
        assert.equal(root.type, expectedRoot.component);
        if ('text' in expectedRoot) assert.equal(props.text.value, expectedRoot.text);
        if ('details' in expectedRoot) assert.deepEqual(props.details.value, expectedRoot.details);
      } else if (root.type === 'CustomCard') {
        const [frame] = entry.payload;
        const input = frame.createSurface.components[0].details;
        const expected = Object.fromEntries(Object.entries(input).map(([key, value]) =>
          [key.startsWith('@@') ? key.slice(1) : key, value]));
        assert.deepEqual(props.details.value, expected);
      } else if (entry.name === 'test_reserved_at_path_valid') {
        await protocol.receive({version: '1.0', updateDataModel: {
          surfaceId: 's1', path: '/user', value: {displayName: 'Ada'},
        }});
        assert.equal(getValue(root.props).text.value, 'Ada');
      } else if (entry.name === 'test_reserved_at_call_valid') {
        assert.equal(props.text.value, 'Hello world');
      } else if (entry.name === 'test_reserved_at_call_index') {
        await protocol.receive({version: '1.0', updateDataModel: {surfaceId: 's1', path: '/items', value: ['a', 'b']}});
        assert.deepEqual(getValue(root.props).children.map(child => getValue(child.props).text.value), [1, 2]);
      } else {
        assert.fail('Missing resolved value assertion for ' + entry.name);
      }
      assert.deepEqual(sent, []);
    }
    assert.deepEqual(transportErrors, []);
  } finally {
    resolver?.dispose();
    protocol.dispose();
  }
}

for (const file of ['expressions', 'reserved_keys']) {
  const entries = parse(readFileSync(new URL('./fixtures/a2ui-v1/' + file + '.yaml', import.meta.url), 'utf8'));
  const suite = 'core/' + file + '.yaml';
  for (const entry of entries) {
    test(entry.name, async () => {
      try {
        if (entry.action === 'parse_expression_template') assertParsed(entry);
        else await assertResolved(entry);
        record(suite, entry.name, 'passed');
      } catch (error) {
        record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
        throw error;
      }
    });
  }
}

test('a mounted action preserves literal keys alongside an evaluated binding', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    try {
      await page.goto(origin + '/test-support/fixture-host.html');
      await page.evaluate(catalogId => window.fixture.projection.receive({version: '1.0', createSurface: {
        surfaceId: 'mixed', catalogId, dataModel: {selection: 'work'},
        components: [
          {id: 'root', component: 'Button', child: 'label', action: {event: {name: 'inspect', context: {
            details: {
              path: 'literal path',
              call: 'literal call',
              '@@path': 'escaped path',
              '@@metadata': 'escaped metadata',
              selected: {'@path': '/selection'},
            },
          }}}},
          {id: 'label', component: 'Text', text: 'Inspect'},
        ],
      }}), basicCatalog.id);
      await page.getByRole('button', {name: 'Inspect'}).click();
      const [sent] = await page.evaluate(() => window.fixture.outbound);
      assertWireMessage(sent.message);
      assert.deepEqual(sent.message.action.context, {details: {
        path: 'literal path', call: 'literal call', '@path': 'escaped path',
        '@metadata': 'escaped metadata', selected: 'work',
      }});
      assert.equal(await page.evaluate(() => window.fixture.outbound.length), 1);
    } finally {
      await page.close();
    }
  });
});
