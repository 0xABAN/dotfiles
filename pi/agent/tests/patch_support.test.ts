import { test } from "bun:test";
import { fileURLToPath } from "node:url";
import { checkProcess, patchModule, temporaryDirectory } from "./support/patch_fixtures";

const support = fileURLToPath(new URL("../patches/patch_support.py", import.meta.url));
const temp = temporaryDirectory("patch-support-");

function check(code: string): void {
  checkProcess(patchModule(support, code, [temp]));
}

test("SDK discovery keeps override, missing-npm and subprocess-error behavior", () => {
  check(`
import os, subprocess
from unittest.mock import patch
root = pathlib.Path(sys.argv[2])
with patch.dict(os.environ, {'HOME': str(root), 'PI_SDK_ROOT': '~/sdk'}):
    with patch('shutil.which') as which:
        assert m['discover_pi_root']() == root / 'sdk'
        which.assert_not_called()
with patch.dict(os.environ, {'PI_SDK_ROOT': ''}):
    with patch('shutil.which', return_value=None), patch('subprocess.run') as run:
        assert m['discover_pi_root']() is None
        run.assert_not_called()
    with patch('shutil.which', return_value='/bin/npm'):
        result = subprocess.CompletedProcess([], 0, '/global/modules\\n', '')
        with patch('subprocess.run', return_value=result) as run:
            assert m['discover_pi_root']() == pathlib.Path('/global/modules/@earendil-works/pi-coding-agent')
            run.assert_called_once_with(['npm', 'root', '-g'], capture_output=True, text=True, check=True)
        with patch('subprocess.run', side_effect=subprocess.CalledProcessError(1, ['npm'])):
            try:
                m['discover_pi_root']()
                raise AssertionError('discovery swallowed npm failure')
            except subprocess.CalledProcessError:
                pass
`);
});

test("backups preserve originals and distinguish absent versus empty manifests", () => {
  check(`
import os
root = pathlib.Path(sys.argv[2]) / 'package'
(root / 'nested').mkdir(parents=True)
(root / 'nested/source.ts').write_text('original')
os.environ['HOME'] = str(root)
for added in [None, [], ['nested/new.ts']]:
    backup = m['backup_sources'](root, ['nested/source.ts'], 'fixture-', added_files=added)
    assert (backup / 'nested/source.ts').read_text() == 'original'
    manifest = backup / 'added-files.json'
    assert manifest.exists() == (added is not None)
    if added is not None:
        assert manifest.read_text() == json.dumps(added) + '\\n'
m['write_sources'](root, {'nested/source.ts': 'changed', 'nested/new.ts': 'added'})
assert (root / 'nested/source.ts').read_text() == 'changed'
assert (root / 'nested/new.ts').read_text() == 'added'
`);
});

test("counted replacements retain ordering, reverse traversal and exact diagnostics", () => {
  check(`
edits = [('a', 'bb', 1), ('bb', 'c', 1)]
apply = m['replace_counted']
assert apply('a', edits, 'fixture anchor') == 'c'
assert apply('c', edits, 'fixture anchor', reverse=True) == 'a'
for source in ['', 'aa']:
    try:
        apply(source, edits, 'fixture anchor')
        raise AssertionError('accepted a missing or duplicated anchor')
    except ValueError as error:
        assert str(error) == "fixture anchor 'a'"
`);
});
