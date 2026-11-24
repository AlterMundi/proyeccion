import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {createServer} from 'vite';

/** Run tests against a loopback-only browser host and close both owned processes. */
export async function withBrowser(run) {
  const server = await createServer({
    optimizeDeps: {
      entries: ['index.html', 'test-support/fixture-host.html'],
      include: ['lit', '@a2ui/web_core/catalog', 'zod'],
    },
    server: {host: '127.0.0.1', port: 0},
  });
  await server.listen();
  let browser;
  try {
    const systemChromium = '/usr/bin/chromium';
    const executablePath = process.env.PROYECCION_CHROMIUM
      || (existsSync(systemChromium) ? systemChromium : undefined);
    browser = await chromium.launch({executablePath, args: ['--enable-unsafe-swiftshader']});
    await run(browser, 'http://127.0.0.1:' + server.httpServer.address().port);
  } finally {
    await browser?.close();
    await server.close();
  }
}
