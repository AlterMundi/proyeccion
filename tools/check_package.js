import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {constants, copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this check with npm run check:package.');

const consumer = await mkdtemp(join(tmpdir(), 'proyeccion-consumer-'));
try {
  const [pack] = JSON.parse(execFileSync(process.execPath, [npm, 'pack', '--json', '--pack-destination', consumer], {
    encoding: 'utf8',
  }));
  const archive = join(consumer, pack.filename);
  assert.ok(pack.files.some(file => file.path === 'src/index.js'));
  assert.ok(pack.files.every(file => file.path.startsWith('src/')
    || ['package.json', 'README.md', 'LICENSE', 'docs/conformance.md'].includes(file.path)));
  await writeFile(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');
  execFileSync(process.execPath, [npm, 'install', '--prefer-offline', '--ignore-scripts', '--no-audit',
    '--no-fund', archive, 'three@0.182.0'], {cwd: consumer, stdio: 'inherit'});

  await Promise.all([
    copyFile('index.html', join(consumer, 'index.html')),
    cp('examples', join(consumer, 'examples'), {recursive: true}),
  ]);
  execFileSync(process.execPath, ['--test', 'test/browser.test.js'], {
    env: {...process.env, PROYECCION_BROWSER_PROJECT: consumer},
    stdio: 'inherit',
  });

  const {peerDependencies, devDependencies} = JSON.parse(await readFile('package.json', 'utf8'));
  const catalogPeers = ['vega', 'vega-lite', 'vega-interpreter', '@a2ui/catalog-mcp']
    .map(name => name + '@' + peerDependencies[name]);
  const appSdk = '@modelcontextprotocol/ext-apps';
  execFileSync(process.execPath, [npm, 'install', '--prefer-offline', '--ignore-scripts', '--no-audit',
    '--no-fund', ...catalogPeers, appSdk + '@' + devDependencies[appSdk]], {cwd: consumer, stdio: 'inherit'});
  await mkdir(join(consumer, 'test-support'));
  for (const file of ['fixture-host.html', 'fixture-host.js', 'mcp-app-view.js']) {
    await copyFile(join('test-support', file), join(consumer, 'test-support', file));
  }
  execFileSync(process.execPath, ['--test', '--test-concurrency=1',
    'test/a2a-conformance.test.js', 'test/ag-ui-conformance.test.js', 'test/e2e-transcripts.test.js',
    'test/http-live-conformance.test.js', 'test/validation-conformance.test.js', 'test/vegachart-conformance.test.js',
    'test/mcp-app-conformance.test.js', 'test/mcp-transport-conformance.test.js',
    'test/sse-jsonrpc-conformance.test.js', 'test/http-turn-conformance.test.js', 'test/websocket-conformance.test.js',
    ...(process.env.PROYECCION_MCP_PYTHON ? ['tools/check_mcp_stateful.js'] : [])], {
    env: {...process.env, PROYECCION_BROWSER_PROJECT: consumer},
    stdio: 'inherit',
  });
  const destination = process.env.PROYECCION_PACKAGE_OUT_DIR;
  if (destination) {
    await mkdir(destination, {recursive: true});
    await copyFile(archive, join(destination, pack.filename), constants.COPYFILE_EXCL);
  }
  console.log('Installed renderer package passed the Chromium agent round trip:', pack.filename, pack.integrity);
} finally {
  await rm(consumer, {recursive: true});
}
