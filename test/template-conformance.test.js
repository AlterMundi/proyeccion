import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {DataContext, NodeResolver, getValue} from '@a2ui/web_core';
import {parse} from 'yaml';
import {basicCatalog, createProtocol} from '../src/protocol.js';
import {withBrowser} from '../test-support/browser.js';
import {record} from '../test-support/conformance-manifest.js';
import {assertWireMessage} from '../test-support/wire-check.js';

const basic = basicCatalog.copyWith({catalogId: 'basic'});

async function assertContext(entry) {
  let surface;
  const outbound = [];
  const protocol = createProtocol({
    catalogs: [basic],
    send: message => outbound.push(message),
    onSurfaceCreated: created => { surface = created; },
  });
  try {
    assert.equal(entry.action, 'resolve_path');
    await protocol.receive({version: '1.0', createSurface: {surfaceId: 's', catalogId: 'basic'}});
    const ctx = new DataContext(surface, entry.args.contextPath ?? '/');
    assert.equal(ctx.resolvePath(entry.args.path), entry.expect);
    assert.deepEqual(outbound, []);
  } finally {
    protocol.dispose();
  }
}

async function assertTemplate(entry) {
  let resolver;
  const messages = [];
  const protocol = createProtocol({
    catalogs: [basic],
    send: message => messages.push(message),
    onSurfaceCreated: surface => { resolver = new NodeResolver(surface); },
  });
  try {
    assert.equal(entry.action, 'validate');
    for (const step of entry.steps) {
      for (const message of step.payload) await protocol.receive(message);
    }
    const root = getValue(resolver.rootNode);
    assert.equal(root.state, 'resolved');
    if (!entry.expect) {
      const {expectError} = entry.steps[0];
      assert.equal(expectError.category, 'ValidationError');
      assert.equal(getValue(root.props).text.value ?? null, null);
      assert.ok(messages.length);
      for (const message of messages) {
        assertWireMessage(message);
        assert.equal(message.error.code, 'EXPRESSION_ERROR');
        assert.equal(message.error.surfaceId, 'main');
        assert.ok(message.error.message.includes(expectError.message));
      }
      return;
    }
    const actual = {};
    function visit(node, index) {
      assert.equal(node.state, 'resolved');
      const props = getValue(node.props);
      if (node.type === 'Text') actual[node.componentId + '_' + index] = {text: String(props.text.value)};
      const children = props.children ?? [];
      for (const [i, child] of children.entries()) visit(child, node.type === 'List' ? i : index);
    }
    visit(root);
    assert.deepEqual(actual, entry.expect.surfaces.main.components);
    assert.deepEqual(messages, []);
  } finally {
    resolver?.dispose();
    protocol.dispose();
  }
}

for (const [name, verify] of [['data_context', assertContext], ['index_function', assertTemplate]]) {
  const entries = parse(readFileSync(new URL('./fixtures/a2ui-v1/' + name + '.yaml', import.meta.url), 'utf8'));
  const suite = 'core/' + name + '.yaml';
  for (const entry of entries) {
    test(entry.name, async () => {
      try {
        await verify(entry);
        record(suite, entry.name, 'passed');
      } catch (error) {
        record(suite, entry.name, 'failed', String(error.message).slice(0, 1400));
        throw error;
      }
    });
  }
}

test('nested lists render the innermost index and refresh on a bound data update', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    try {
      await page.goto(origin + '/test-support/fixture-host.html');
      await page.evaluate(({catalogId}) => {
        const label = value => ({'@call': 'formatString', args: {value}});
        window.fixture.projection.receive({version: '1.0', createSurface: {
          surfaceId: 'nested', catalogId,
          dataModel: {groups: [
            {name: 'A', entries: [{name: 'one'}]},
            {name: 'B', entries: [{name: 'two'}, {name: 'three'}]},
          ]},
          components: [
            {id: 'root', component: 'List', children: {path: '/groups', componentId: 'group'}},
            {id: 'group', component: 'Column', children: ['title', 'entries']},
            {id: 'title', component: 'Text', text: label('Group ${@index()}: ${name}')},
            {id: 'entries', component: 'List', children: {path: 'entries', componentId: 'entry'}},
            {id: 'entry', component: 'Text', text: label('Item ${@index()}: ${name}')},
          ],
        }});
      }, {catalogId: basicCatalog.id});
      const text = page.locator('a2ui-surface a2ui-basic-text');
      await text.last().waitFor({state: 'visible'});
      assert.deepEqual((await text.allTextContents()).map(value => value.trim()), [
        'Group 0: A', 'Item 0: one', 'Group 1: B', 'Item 0: two', 'Item 1: three',
      ]);
      await page.evaluate(() => window.fixture.projection.receive({version: '1.0', updateDataModel: {
        surfaceId: 'nested', path: '/groups/1/entries', value: [{name: 'three'}, {name: 'two'}],
      }}));
      await page.getByText('Item 1: two', {exact: true}).waitFor({state: 'visible'});
      assert.deepEqual((await text.allTextContents()).map(value => value.trim()), [
        'Group 0: A', 'Item 0: one', 'Group 1: B', 'Item 0: three', 'Item 1: two',
      ]);
      assert.deepEqual(await page.evaluate(() => window.fixture.outbound), []);
    } finally {
      await page.close();
    }
  });
});
