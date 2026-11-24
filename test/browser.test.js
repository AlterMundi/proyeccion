import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';
import {A2uiGenerator, CatalogConfig, DirectJsonFormatFactory, RendererToAgentMessageProcessor} from '@a2ui/agent';
import {basicCatalog} from '../src/protocol.js';
import {assertWireMessage, assertWireCapabilities} from '../test-support/wire-check.js';

test('transformed surface round trip with browser pointer, keyboard and scene ray', {timeout: 35000}, async () => {
  const server = await createServer({server: {host: '127.0.0.1', port: 0}});
  await server.listen();
  let browser;
  try {
    const systemChromium = '/usr/bin/chromium';
    const executablePath = process.env.PROYECCION_CHROMIUM
      || (existsSync(systemChromium) ? systemChromium : undefined);
    browser = await chromium.launch({
      executablePath,
      args: ['--enable-unsafe-swiftshader'],
    });
    const page = await browser.newPage({viewport: {width: 950, height: 700}});
    page.setDefaultTimeout(6000);
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const {port} = server.httpServer.address();
    await page.goto('http://127.0.0.1:' + port);
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
  } finally {
    await browser?.close();
    await server.close();
  }
});
