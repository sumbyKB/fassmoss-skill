"""Build a source-only ZIP for colleagues; never copy browser profiles or outputs."""
import argparse
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ROOT_FILES = ('.gitignore', 'README.md', 'SKILL.md', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md',
              'package.json', 'package-lock.json', 'agents/openai.yaml')


def source_files():
    for name in ROOT_FILES:
        yield ROOT / name
    for directory in ('scripts', 'references'):
        for item in sorted((ROOT / directory).rglob('*')):
            if item.is_file() and item.suffix in ('.py', '.mjs', '.md', '.json'):
                if not item.name.endswith('.test.mjs') and '__pycache__' not in item.parts:
                    yield item


def main():
    parser = argparse.ArgumentParser(description='生成不包含登录态、数据与测试文件的同事使用包')
    parser.add_argument('--out', type=Path, default=ROOT / 'outputs' / 'distribution' / 'fastmoss-skill.zip')
    args = parser.parse_args()
    destination = args.out.resolve()
    if destination.suffix.lower() != '.zip':
        parser.error('--out 必须为 .zip')
    files = list(source_files())
    # 不跟随源目录中的链接，不允许输出覆盖源文件。
    for item in files:
        if not item.is_file() or item.is_symlink() or not item.resolve().is_relative_to(ROOT):
            raise ValueError('源文件缺失或不是项目内普通文件: ' + str(item.relative_to(ROOT)))
        if item.resolve() == destination:
            raise ValueError('输出不能覆盖源文件')
    destination.parent.mkdir(parents=True, exist_ok=True)
    # 独占创建，不静默覆盖同事已经取得的包。
    with zipfile.ZipFile(destination, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for item in files:
            archive.write(item, Path('fassmoss-skill') / item.relative_to(ROOT))
    print('Created:', destination)
    print('Source files:', len(files))
    print('Excluded: browser profiles, dependencies, outputs, operations, AIOS state and tests')


if __name__ == '__main__':
    main()
