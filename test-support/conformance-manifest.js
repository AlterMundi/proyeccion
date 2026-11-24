import {appendFileSync, mkdirSync} from 'node:fs';
import {join} from 'node:path';

export function record(suite, name, status, reason) {
  const directory = process.env.A2UI_CONFORMANCE_MANIFEST_DIR;
  if (!directory) return;
  mkdirSync(directory, {recursive: true});
  const target = 'proyeccion-' + suite.split('/').at(-1) + '-' + process.pid + '.jsonl';
  appendFileSync(join(directory, target),
    JSON.stringify({harness: 'proyeccion', suite, case: name,
      status, ...(reason ? {reason} : {})}) + '\n');
}
