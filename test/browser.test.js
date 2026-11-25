import assert from 'node:assert/strict';
import test from 'node:test';
import {withBrowser} from '../test-support/browser.js';
import {
  A2uiGenerator, CatalogConfig, DirectJsonFormatFactory, ExpressFormatFactory, RendererToAgentMessageProcessor,
} from '@a2ui/agent';
import {basicCatalog} from '../src/protocol.js';
import {assertWireMessage, assertWireCapabilities} from '../test-support/wire-check.js';
import {sharedWorkbench} from '../examples/shared-vite.js';

test('transformed surface round trip with browser pointer, keyboard and scene ray', {timeout: 35000}, async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage({viewport: {width: 950, height: 700}});
    page.setDefaultTimeout(6000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto(origin);
    const input = page.getByRole('textbox', {name: 'View name'});
    const apply = page.getByRole('button', {name: 'Apply name', exact: true});
    await input.waitFor();
    await page.locator('strong').filter({hasText: 'Name this view'}).waitFor();
    assert.equal(await apply.count(), 1);
    const before = await apply.boundingBox();
    await page.getByRole('button', {name: 'Change viewpoint'}).click();
    assert.notDeepEqual(await apply.boundingBox(), before);
    await input.fill('Projection rehearsal');
    const receipt = () => page.evaluate(async () => {
      const {workspace} = await import('/examples/workspace.js');
      return {sent: workspace.sent, failures: workspace.failures};
    });
    assert.equal((await receipt()).sent.length, 0);

    await apply.click();
    await page.getByText('Applied: Projection rehearsal').waitFor();
    assert.equal((await receipt()).sent.length, 1);
    await apply.focus();
    await page.keyboard.press('Enter');
    assert.equal((await receipt()).sent.length, 2);

    const {x, y, width, height} = await apply.boundingBox();
    const rayResult = await page.evaluate(async ({x, y}) => {
      const {workspace} = await import('/examples/workspace.js');
      return [workspace.activateAt(x, y), workspace.activateAt(-20, -20)];
    }, {x: x + width / 2, y: y + height / 2});
    assert.deepEqual(rayResult, [true, false]);
    const {sent, failures} = await receipt();
    assert.equal(sent.length, 3);
    assert.deepEqual(failures, []);
    for (const [index, {message, metadata}] of sent.entries()) {
      assertWireMessage(message, metadata);
      const {timestamp, ...action} = message.action;
      assert.ok(Number.isFinite(Date.parse(timestamp)));
      assert.deepEqual(action, {
        name: 'applyTitle', surfaceId: 'workbench', sourceComponentId: 'apply',
        context: {title: 'Projection rehearsal', revision: index},
      });
      assert.deepEqual(metadata, {a2uiRendererDataModel: {
        version: '1.0', surfaces: {workbench: {
          title: 'Projection rehearsal', revision: index,
          response: index === 0
            ? 'Ready to name this view' : 'Applied: Projection rehearsal',
        }},
      }});
    }
    const direct = await page.evaluate(async () => {
      const {workspace: {companion, sent}} = await import('/examples/workspace.js');
      const location = companion.locate();
      const before = companion.read(location.subjectRef);
      const expectedRevision = before.revision;
      const after = companion.rename({
        subjectRef: location.subjectRef, expectedRevision, title: 'Companion revision',
      });
      let staleRejected = false;
      try {
        companion.rename({subjectRef: location.subjectRef, expectedRevision, title: 'Stale'});
      } catch {
        staleRejected = true;
      }
      return {location, before, after, uiActionCount: sent.length, staleRejected};
    });
    assert.deepEqual(direct, {
      location: {projectionId: 'workbench', subjectRef: 'study:weaver'},
      before: {title: 'Projection rehearsal', revision: 3, actor: 'fixture-human'},
      after: {title: 'Companion revision', revision: 4, actor: 'fixture-companion'},
      uiActionCount: 3,
      staleRejected: true,
    });
    await page.getByText('Applied: Companion revision').waitFor();
    assert.equal(await input.inputValue(), 'Companion revision');

    await page.setViewportSize({width: 380, height: 720});
    await page.waitForFunction(() => {
      const left = document.querySelector('.proyeccion-layer');
      return left?.style.width === '380px';
    });
    const narrow = await apply.boundingBox();
    assert.ok(narrow.x >= 0 && narrow.x + narrow.width <= 380, JSON.stringify(narrow));

    // Drive a separate browser surface using the published agent SDK's
    // parser, capabilities negotiation and validated action callback.
    const capabilities = await page.evaluate(async () => {
      const {workspace} = await import('/examples/workspace.js');
      workspace.projection.receive({version: '1.0', deleteSurface: {surfaceId: 'workbench'}});
      return workspace.projection.capabilities();
    });
    assertWireCapabilities(capabilities);
    const generator = new A2uiGenerator(
      [new CatalogConfig(basicCatalog)], undefined, new DirectJsonFormatFactory(),
    );
    const processor = generator.createProcessor(capabilities);
    const state = processor.createState();
    const produce = packet => processor
      .parseResponse('<a2ui-json>' + JSON.stringify([packet]) + '</a2ui-json>', {state})
      .flatMap(part => part.a2ui ?? []);
    const deliver = envelopes => page.evaluate(async envelopes => {
      const {workspace} = await import('/examples/workspace.js');
      for (const envelope of envelopes) workspace.projection.receive(envelope);
    }, envelopes);
    await deliver(produce({
      version: '1.0',
      createSurface: {
        surfaceId: 'agent_sdk', catalogId: basicCatalog.id,
        components: [
          {id: 'root', component: 'Button', child: 'label', action: {event: {name: 'confirm'}}},
          {id: 'label', component: 'Text', text: 'Confirm study'},
        ],
      },
    }));
    const confirm = page.getByRole('button', {name: 'Confirm study'});
    await confirm.click();

    const agent = new RendererToAgentMessageProcessor({
      catalogs: [basicCatalog],
      async onAction({action}) {
        assert.equal(action.name, 'confirm');
        assert.equal(action.surfaceId, 'agent_sdk');
        await deliver(produce({
          version: '1.0',
          updateComponents: {
            surfaceId: action.surfaceId,
            components: [{id: 'label', component: 'Text', text: 'Study confirmed'}],
          },
        }));
      },
    });
    const agentAction = (await receipt()).sent.at(-1).message;
    assertWireMessage(agentAction);
    assert.equal((await agent.processMessage(agentAction)).handled, true);
    await page.getByRole('button', {name: 'Study confirmed'}).waitFor();

    const leftHostObject = await page.evaluate(async () => {
      const {workspace} = await import('/examples/workspace.js');
      workspace.dispose();
      return workspace.scene.children.includes(workspace.grid);
    });
    assert.equal(leftHostObject, true);
    assert.equal(await page.getByRole('button', {name: 'Study confirmed'}).count(), 0);
    assert.deepEqual(pageErrors, []);
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('streamed Express updates from the Agent SDK use the same A2UI 1.0 browser renderer', async () => {
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    try {
      await page.goto(origin);
      const capabilities = await page.evaluate(async () => {
        const {workspace} = await import('/examples/workspace.js');
        return workspace.projection.capabilities();
      });
      assertWireCapabilities(capabilities);
      const generator = new A2uiGenerator([new CatalogConfig(basicCatalog)], undefined, new ExpressFormatFactory());
      const processor = generator.createProcessor(capabilities);
      const state = processor.createState();
      const deliver = parts => page.evaluate(async parts => {
        const {workspace} = await import('/examples/workspace.js');
        return workspace.projection.receiveBatch(parts.flatMap(part => part.a2ui ?? []));
      }, parts);
      const stream = processor.openStream({state});
      const first = stream.feed('<a2ui>\nsurface("express_demo")\nroot = Button(label, action=Event("confirmExpress"))\n');
      assert.deepEqual(first.flatMap(part => part.a2ui ?? []).map(message => message.createSurface?.surfaceId),
        ['express_demo']);
      await deliver(first);
      assert.equal(await page.evaluate(async () => {
        const {workspace} = await import('/examples/workspace.js');
        return workspace.projection.hasSurface('express_demo');
      }), true);
      const pending = page.getByRole('button', {name: 'Confirm Express', exact: true});
      assert.equal(await pending.count(), 0);
      await deliver(stream.feed('label = Text("Confirm Express", id="express_label")\n</a2ui>'));
      await deliver(stream.close());
      await pending.click();
      const action = await page.evaluate(async () => {
        const {workspace} = await import('/examples/workspace.js');
        return workspace.sent.at(-1).message;
      });
      assertWireMessage(action);
      const agent = new RendererToAgentMessageProcessor({
        catalogs: [basicCatalog],
        async onAction({action}) {
          assert.equal(action.surfaceId, 'express_demo');
          assert.equal(action.sourceComponentId, 'root');
          assert.equal(action.name, 'confirmExpress');
          await deliver(processor.parseResponse(
            '<a2ui>\nsurface("express_demo", update=true)\nexpress_label = Text("Express confirmed")\n</a2ui>',
            {state},
          ));
        },
      });
      assert.equal((await agent.processMessage(action)).handled, true);
      await page.getByRole('button', {name: 'Express confirmed', exact: true}).waitFor();
      assert.deepEqual(await page.evaluate(async () => {
        const {workspace} = await import('/examples/workspace.js');
        return workspace.failures;
      }), []);
    } finally {
      await page.close();
    }
  }, process.env.PROYECCION_BROWSER_PROJECT);
});

test('the shared example reflects browser and direct domain actions in two views', {timeout: 25000}, async () => {
  await withBrowser(async (browser, origin) => {
    const left = await browser.newPage({viewport: {width: 900, height: 680}});
    left.setDefaultTimeout(5000);
    await left.goto(origin + '/examples/shared.html');
    const [right] = await Promise.all([
      left.waitForEvent('popup'),
      left.getByRole('link', {name: 'Open another view'}).click(),
    ]);
    right.setDefaultTimeout(5000);
    const field = page => page.getByRole('textbox', {name: 'View name'});
    await right.getByRole('textbox', {name: 'View name'}).waitFor();
    await field(left).fill('Shared projection');
    assert.equal(await field(right).inputValue(), 'Weaver study');
    await left.getByRole('button', {name: 'Apply name'}).click();
    await right.getByText('Applied: Shared projection', {exact: true}).waitFor();
    assert.equal(await field(right).inputValue(), 'Shared projection');

    const endpoint = origin + '/api/workbench/subject';
    const read = async () => (await fetch(endpoint)).json();
    assert.deepEqual(await read(), {
      subjectRef: 'study:weaver', title: 'Shared projection', revision: 1, actor: 'fixture-human',
    });
    const direct = {subjectRef: 'study:weaver', expectedRevision: 1, title: 'Direct application update'};
    const rename = title => fetch(endpoint, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...direct, title}),
    });
    const confirmed = await rename(direct.title);
    assert.equal(confirmed.status, 200);
    assert.deepEqual(await confirmed.json(), {
      subjectRef: 'study:weaver', title: direct.title, revision: 2, actor: 'fixture-companion',
    });
    for (const page of [left, right]) {
      await page.getByText('Applied: Direct application update', {exact: true}).waitFor();
      assert.equal(await field(page).inputValue(), direct.title);
    }
    assert.equal((await rename('Stale write')).status, 409);
    assert.equal((await read()).title, direct.title);
    await right.close();
    await left.close();
  }, process.env.PROYECCION_BROWSER_PROJECT, [sharedWorkbench()]);
});

test('the browser and Three.js workbench commit to the same subject revision', {timeout: 25000}, async () => {
  await withBrowser(async (browser, origin) => {
    const web = await browser.newPage({viewport: {width: 900, height: 680}});
    const table = await browser.newPage({viewport: {width: 900, height: 680}});
    await web.goto(origin + '/examples/shared.html');
    const tableLink = await web.getByRole('link', {name: 'Open Three.js controls'}).getAttribute('href');
    await table.goto(new URL(tableLink, web.url()).href);
    const webTitle = web.getByRole('textbox', {name: 'View name'});
    const tablePanel = table.getByRole('group', {name: 'Shared study controls'});
    await tablePanel.getByText('Applied: Weaver study', {exact: true}).waitFor();

    await webTitle.fill('From the browser');
    await web.getByRole('button', {name: 'Apply name'}).click();
    await tablePanel.getByText('Applied: From the browser', {exact: true}).waitFor();

    await table.bringToFront();
    const canvas = table.locator('canvas[aria-label="Three.js workbench"]');
    const bounds = await canvas.boundingBox();
    await canvas.click({position: {x: Math.floor(bounds.width / 2), y: Math.floor(bounds.height / 2 - 21)}});
    const editor = table.getByRole('textbox', {name: 'View name'});
    assert.equal(await editor.inputValue(), 'From the browser');
    await editor.fill('From the Three.js controls');
    assert.equal(await webTitle.inputValue(), 'From the browser');
    await editor.press('Enter');
    await web.getByText('Applied: From the Three.js controls', {exact: true}).waitFor();

    const endpoint = origin + '/api/workbench/subject';
    const read = async () => (await fetch(endpoint)).json();
    assert.deepEqual(await read(), {
      subjectRef: 'study:weaver', title: 'From the Three.js controls', revision: 2, actor: 'fixture-human',
    });
    const applied = await fetch(endpoint, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({subjectRef: 'study:weaver', expectedRevision: 2, title: 'From the domain port'}),
    });
    assert.equal(applied.status, 200);
    await tablePanel.getByText('Applied: From the domain port', {exact: true}).waitFor();
    await web.getByText('Applied: From the domain port', {exact: true}).waitFor();
    assert.equal((await read()).actor, 'fixture-companion');
    await table.close();
    await web.close();
  }, process.env.PROYECCION_BROWSER_PROJECT, [sharedWorkbench()]);
});
