"""Verify executed renderer cases against the pinned A2UI corpus."""

import argparse
from collections import Counter
import json
from pathlib import Path
import subprocess
import sys


A2UI_REVISION = 'a337e800ede809c3a8ebca604918149380c11ec6'
FIXTURES = Path(__file__).resolve().parent.parent / 'test' / 'fixtures' / 'a2ui-v1'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('upstream', type=Path, help='checkout at the pinned A2UI revision')
    parser.add_argument('results', type=Path, help='executed-case manifest directory')
    args = parser.parse_args()
    current = subprocess.check_output(
        ['git', '-C', str(args.upstream), 'rev-parse', 'HEAD'], text=True,
    ).strip()
    if current != A2UI_REVISION:
        parser.error(f'Expected A2UI {A2UI_REVISION}, found {current}')
    root = args.upstream.resolve() / 'conformance'
    suites = []
    fixtures = [*FIXTURES.glob('*.yaml'), *(FIXTURES / 'extensions').rglob('*.yaml')]
    for fixture in sorted(fixtures):
        relative = fixture.relative_to(FIXTURES)
        candidates = ([root / relative] if relative.parts[0] == 'extensions'
                      else [root / corpus / fixture.name for corpus in ('core', 'adapter')])
        existing = [path for path in candidates if path.is_file()]
        if len(existing) != 1 or existing[0].read_bytes() != fixture.read_bytes():
            parser.error(f'No exact upstream match for {fixture.name}')
        suites.extend(['--only', existing[0].relative_to(root).as_posix()])
    if not suites:
        parser.error('No vendored fixture suites found')

    subprocess.run([
        sys.executable, str(root / 'scripts' / 'check_executed_cases.py'),
        '--manifest-dir', str(args.results.resolve()), '--harness', 'proyeccion',
        '--corpus', 'core', '--corpus', 'adapter', '--corpus', 'extensions', *suites,
    ], check=True)

    records = [
        json.loads(line)
        for path in sorted(args.results.glob('*.jsonl'))
        for line in path.read_text().splitlines()
        if line.strip()
    ]
    counts = Counter(record['status'] for record in records if record['harness'] == 'proyeccion')
    print(f'Proyeccion: {counts["passed"]} passed, {counts["skipped"]} excluded')


if __name__ == '__main__':
    main()
