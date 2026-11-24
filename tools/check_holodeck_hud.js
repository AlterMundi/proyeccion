import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFile, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {brotliCompressSync, constants} from 'node:zlib';
import {withBrowser} from '../test-support/browser.js';
import {publicModel, restrictedModel, startHolodeckWorktable} from '../test-support/holodeck-worktable.js';

const [checkout, packedArchive] = process.argv.slice(2);
const npm = process.env.npm_execpath;
if (!checkout || !npm) {
  throw new Error('Run npm run check:holodeck-hud -- /path/to/holodeck [archive] after installing both projects.');
}
const host = resolve(checkout);
const hostManifest = JSON.parse(await readFile(join(host, 'package.json'), 'utf8'));
assert.equal(hostManifest.name, '@altermundi/holodeck');
const hostModules = join(host, 'node_modules');
const readPackage = async name =>
  JSON.parse(await readFile(join(hostModules, name, 'package.json'), 'utf8'));
for (const dependency of ['three', '@mml-io/3d-web-threejs']) {
  assert.equal((await readPackage(dependency)).version, hostManifest.dependencies[dependency]);
}
assert.equal((await readPackage('esbuild')).version, hostManifest.devDependencies.esbuild);

const esbuild = createRequire(join(host, 'package.json'))('esbuild');
const stage = await mkdtemp(join(tmpdir(), 'proyeccion-holodeck-hud-'));
try {
  let archive;
  if (packedArchive) archive = resolve(packedArchive);
  else {
    const [pack] = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--json', '--pack-destination', stage]));
    archive = join(stage, pack.filename);
  }
  await writeFile(join(stage, 'package.json'), '{"private":true,"type":"module"}\n');
  execFileSync(process.execPath, [npm, 'install', '--prefer-offline', '--ignore-scripts', '--no-audit',
    '--no-fund', '--omit=optional', archive, 'three@' + hostManifest.dependencies.three], {cwd: stage, stdio: 'inherit'});

  // An ordinary Holodeck install puts the renderer and host in one package
  // tree. Reuse the selected dependency in the host checkout for both roots.
  const threeEntry = join(hostModules, 'three', 'build', 'three.module.js');
  const build = contents => esbuild.build({
    absWorkingDir: stage, stdin: {contents, resolveDir: stage, sourcefile: 'probe.mjs'},
    nodePaths: [hostModules], bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
    minify: true, write: false, metafile: true, outfile: join(stage, 'probe.js'),
    loader: {'.wasm': 'file'}, assetNames: '[name]-[hash]',
    plugins: [{
      name: 'shared-three', setup(api) { api.onResolve({filter: /^three$/}, () => ({path: threeEntry})); },
    }],
  });
  const [baseline, combined] = await Promise.all([
    build(`export {CameraManager, CollisionsManager} from '@mml-io/3d-web-client-core';
      export {ThreeJSWorldRenderer} from '@mml-io/3d-web-threejs';`),
    build(await readFile(new URL('../test-support/holodeck-hud-probe.js', import.meta.url), 'utf8')),
  ]);
  const threeCore = Object.keys(combined.metafile.inputs).filter(path => path.endsWith('/three/build/three.core.js'));
  assert.equal(threeCore.length, 1);
  await Promise.all(combined.outputFiles.map(file => writeFile(file.path, file.contents)));
  await writeFile(join(stage, 'index.html'), '<!doctype html><title>HUD renderer check</title><main style="position:fixed;inset:0"></main>'
    + '<script type="module" src="/probe.js"></script>');
  await mkdir(join(stage, 'assets'));
  await Promise.all(['air', 'double_jump', 'idle', 'jog', 'run'].map(animation => {
    const file = 'anim_' + animation + '.glb';
    return copyFile(join(host, 'public', 'assets', file), join(stage, 'assets', file));
  }));

  const worktable = await startHolodeckWorktable(host, stage);
  let cameraPlacement;
  await withBrowser(async (browser, origin) => {
    const page = await browser.newPage();
    const exceptions = [];
    page.on('pageerror', error => exceptions.push(error.message));
    await page.goto(origin, {waitUntil: 'networkidle'});
    await page.waitForFunction(() => Boolean(window.hudProbe));
    assert.equal(await page.locator('main > canvas').count(), 1);
    assert.equal(await page.evaluate(() => window.hudProbe.sameThree), true);
    assert.equal(await page.evaluate(() => window.hudProbe.meshPixelsObserved), true);
    assert.equal(await page.getByRole('button', {name: 'Abrir mesa'}).count(), 1);
    const canvas = await page.locator('main > canvas').boundingBox();
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2 + 12);
    await page.waitForFunction(() => window.hudProbe.actions.length === 1);
    assert.deepEqual(await page.evaluate(() => window.hudProbe.actions[0].context), {revision: 3});
    await page.evaluate(() => window.hudProbe.state(4, 'Mesa abierta'));
    assert.equal(await page.getByRole('button', {name: 'Mesa abierta'}).count(), 1);
    cameraPlacement = await page.evaluate(() => window.hudProbe.cameraPlacement);
    if (cameraPlacement) {
      assert.equal(await page.evaluate(() => window.hudProbe.moveCamera()), true);
      await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2 + 12);
      await page.waitForFunction(() => window.hudProbe.actions.length === 2);
      assert.deepEqual(await page.evaluate(() => window.hudProbe.actions[1].context), {revision: 4});
    }
    assert.equal(await page.evaluate(() => window.hudProbe.worldClicks()), 0);
    assert.deepEqual(await page.evaluate(() => window.hudProbe.errors), []);
    await page.evaluate(() => window.hudProbe.dispose());
    assert.equal(await page.locator('[data-spatial-hud-accessibility]').count(), 0);
    assert.deepEqual(exceptions, []);
    await checkNativeWorktable(browser, origin);
  }, stage, [worktable.plugin]).finally(() => worktable.close());
  const size = result => {
    const js = result.outputFiles.find(file => file.path.endsWith('/probe.js')).contents;
    return {bytes: js.length, brotli: brotliCompressSync(js, {params: {
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT, [constants.BROTLI_PARAM_QUALITY]: 6,
    }}).length};
  };
  console.log(JSON.stringify({
    packageSha256: createHash('sha256').update(await readFile(archive)).digest('hex'),
    baseline: size(baseline), combined: size(combined), threeInstances: threeCore.length,
    chromium: 'MML mesh pixels, exclusive canvas pointer action, host update and teardown observed',
    nativeWorktable: 'A2UI action and subscription readback across two native Matter sessions with independent selections and permissions',
    ...(cameraPlacement ? {cameraPlacement: 'WebGL pixels and the same pointer target after moving the camera'} : {}),
  }));
} finally {
  await rm(stage, {recursive: true, force: true});
}

async function checkNativeWorktable(browser, origin) {
  async function visit(actor) {
    const page = await browser.newPage();
    await page.context().addCookies([{name: 'fixture_actor', value: actor, url: origin}]);
    await page.goto(origin);
    await page.waitForFunction(() => Boolean(window.hudProbe));
    await page.evaluate(() => window.hudProbe.openNativeTable());
    assert.deepEqual(await page.evaluate(() => window.hudProbe.errors), []);
    await page.getByRole('button', {name: 'Shared model'}).waitFor({state: 'attached', timeout: 5000});
    return page;
  }
  const [author, visitor] = await Promise.all([visit('owner'), visit('guest')]);
  const button = (page, name) => page.getByRole('button', {name, exact: true});
  const text = (page, value) => page.getByText(value, {exact: true}).waitFor({state: 'attached'});
  const shareDirectly = (page, resource, revision) => page.evaluate(async body => {
    const result = await fetch('/native/api/space/collection', {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body),
    });
    return result.status;
  }, {resource, revision});

  assert.equal(await button(visitor, 'Restricted model').count(), 0);
  assert.ok(await button(visitor, 'Share model').isDisabled());
  await button(visitor, 'Shared model').press('Enter');
  await button(author, 'Restricted model').press('Enter');
  await button(author, 'Share model').press('Enter');
  assert.deepEqual(await author.evaluate(() => window.hudProbe.actions.at(-1).context),
    {resource: restrictedModel, revision: 0});
  assert.equal(await author.evaluate(() => window.hudProbe.lastShare()), 204);
  await Promise.all([
    text(author, 'Table: Restricted model'), text(visitor, 'Table: Empty'),
    visitor.waitForFunction(() => window.hudProbe.nativeRevision() === 1),
  ]);
  assert.equal(await shareDirectly(visitor, publicModel, 1), 403);
  assert.equal(await shareDirectly(author, publicModel, 0), 409);
  assert.equal(await shareDirectly(author, publicModel, 1), 204);
  await Promise.all([
    text(author, 'Table: Shared model'), text(visitor, 'Table: Shared model'),
    text(author, 'Selected: Restricted model'), text(visitor, 'Selected: Shared model'),
  ]);
  for (const [page, name] of [[author, 'Share model'], [visitor, 'Shared model']]) {
    assert.ok(await button(page, name).evaluate(control => control === control.ownerDocument.activeElement));
  }
  for (const page of [author, visitor]) {
    assert.deepEqual(await page.evaluate(() => window.hudProbe.errors), []);
    await page.evaluate(() => window.hudProbe.dispose());
    await page.context().close();
  }
}
