"""Hash-pinned, bounded public downloads and trusted Blender commands (no install)."""
import argparse
import hashlib
from pathlib import Path
import subprocess
import zipfile

HERE = Path(__file__).resolve().parent
CACHE = HERE / '.cache'
REVISION = 'bb293be456f6d2245191f37752d14ec76894740d'
BASE = f'https://raw.githubusercontent.com/Z-Anatomy/Models-of-human-anatomy/{REVISION}/'
SOURCE_HASH = 'e029688545627bd0214b269e1063143abb580aad72b2c2445d6d8a9a0d9da736'
BLEND_HASH = '9f08a17ea0115fed80b2a73ecdf0a1bc2ab2f6956f37c593ce23d513ea35afcd'
BLENDER_HASH = '41da973b9bf95bb312cbeff4d1982feb13259b43c821686b9bafea4dfe5477cf'
BLENDER_NAME = 'blender-4.5.9-windows-x64'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def download(url, path, checksum, maximum):
    if path.exists():
        if digest(path) != checksum:
            raise ValueError(f'Cached checksum mismatch; remove explicitly before retry: {path}')
        return
    partial = path.with_suffix(path.suffix + '.partial')
    try:
        subprocess.run(['curl.exe', '--fail', '--location', '--silent', '--show-error',
                        '--proto', '=https', '--proto-redir', '=https',
                        '--max-time', '120', '--max-filesize', str(maximum),
                        url, '--output', str(partial)], check=True, timeout=130)
        if partial.stat().st_size > maximum:
            raise ValueError('Download exceeds size budget')
        if digest(partial) != checksum:
            raise ValueError(f'Public source checksum mismatch: {url}')
        partial.replace(path)
    finally:
        partial.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['fetch', 'inspect', 'export'])
    parser.add_argument('--blender', type=Path, help='Use a local Blender executable instead of the official portable download')
    args = parser.parse_args()
    CACHE.mkdir(exist_ok=True)
    blend = CACHE / 'Z-Anatomy' / 'Startup.blend'
    if args.command == 'fetch':
        archive = CACHE / 'Z-Anatomy.source.zip'
        download(BASE + 'Z-Anatomy.zip', archive, SOURCE_HASH, 90 * 1024 * 1024)
        with zipfile.ZipFile(archive) as source:
            member = source.getinfo('Z-Anatomy/Startup.blend')
            if member.file_size > 350 * 1024 * 1024:
                raise ValueError('Unexpected blend size')
            # Never unpack or run upstream Python, templates, add-ons or UI presets.
            blend.parent.mkdir(exist_ok=True)
            with source.open(member) as incoming, blend.open('wb') as target:
                while chunk := incoming.read(1024 * 1024):
                    target.write(chunk)
        if digest(blend) != BLEND_HASH:
            raise ValueError('Extracted blend checksum mismatch')
        for name, checksum, limit in [
            ('TA2.csv', '0f9092a328b27dcd15d696d9f9a4087deb229a1aad21b75876657622de835974', 2*1024*1024),
            ('License.txt', '196b66b56551a862e59872f7cdb70e6d9a6ad84e9105962fca8ec28c14e97520', 32*1024),
        ]:
            # Terminology/license were added after the geometry revision; hash-pin them separately.
            download('https://raw.githubusercontent.com/Z-Anatomy/Models-of-human-anatomy/master/' + name,
                     CACHE / name, checksum, limit)
        if not args.blender:
            portable = CACHE / (BLENDER_NAME + '.zip')
            download('https://download.blender.org/release/Blender4.5/' + portable.name,
                     portable, BLENDER_HASH, 450 * 1024 * 1024)
            with zipfile.ZipFile(portable) as archive:
                destination = CACHE.resolve()
                for member in archive.infolist():
                    if not (destination / member.filename).resolve().is_relative_to(destination):
                        raise ValueError('Unsafe official archive path')
                archive.extractall(CACHE)
        print('Verified source, license, TA2 and portable Blender; no source code executed.')
        return
    if not blend.is_file() or digest(blend) != BLEND_HASH:
        raise ValueError('Run fetch first; source blend missing or changed')
    blender = args.blender or CACHE / BLENDER_NAME / 'blender.exe'
    script = HERE / ('inspect_blend.py' if args.command == 'inspect' else 'export_skeleton.py')
    command = [str(blender), '--background', '--factory-startup', '--disable-autoexec',
               str(blend), '--python-exit-code', '1', '--python', str(script), '--']
    if args.command == 'inspect':
        command.append(str(HERE / 'source-inspection.json'))
    subprocess.run(command, check=True, timeout=180)
    if args.command == 'export':
        print('Run npx vitest run tests\\bone-registry.test.ts tests\\assets.test.ts for viewer preflight.')


if __name__ == '__main__':
    main()
