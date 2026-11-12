#!/usr/bin/env python3
"""Transfer and verify a content snapshot over explicit FTPS."""
import argparse
import datetime as dt
import ftplib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import ssl
import stat
import sys
import uuid

from export import relative_path, validate_export


def safe_text(value):
    if not isinstance(value, str) or not value or any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError('Invalid FTPS configuration')
    return value


def safe_path(value):
    value = safe_text(value)
    if '..' in value.split('/'):
        raise ValueError('Invalid backup path')
    return PurePosixPath(value)


def load_config(path):
    info = path.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid not in (0, os.geteuid()):
        raise ValueError('FTPS configuration must be a private, owner-controlled file')
    config = json.loads(path.read_text())
    for key in ('host', 'username', 'password', 'ca_file', 'directory'):
        safe_text(config[key])
    safe_path(config['directory'])
    if not isinstance(config.get('port', 21), int) or not 1 <= config.get('port', 21) <= 65535:
        raise ValueError('Invalid FTPS port')
    return config


def tls_context(config):
    # Trust is scoped to this client. No global trust-store changes or TLS bypass.
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    context.hostname_checks_common_name = False
    context.load_verify_locations(cafile=config['ca_file'])
    return context


class BackupFTPS(ftplib.FTP_TLS):
    def ntransfercmd(self, cmd, rest=None):
        if not self._prot_p:
            raise ValueError('Encrypted FTPS data channel required')
        connection, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        try:
            # Some NAS servers require the data channel to reuse the authenticated
            # control session. Keep certificate/hostname validation on both.
            connection = self.context.wrap_socket(connection, server_hostname=self.host, session=self.sock.session)
        except BaseException:
            connection.close()
            raise
        return connection, size


def digest_file(path):
    digest = hashlib.sha256()
    size = 0
    with path.open('rb') as source:
        while chunk := source.read(65536):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def snapshot_files(state):
    latest = state / 'latest'
    if not latest.is_symlink():
        raise ValueError('No valid local export available')
    snapshot = latest.resolve(strict=True)
    if not snapshot.is_relative_to((state / 'snapshots').resolve()):
        raise ValueError('Invalid local snapshot')
    data = validate_export(json.loads((snapshot / 'export.json').read_text()))
    hashes = json.loads((snapshot / 'sha256.json').read_text())
    expected = {str(relative_path(row['path'])): hashlib.sha256(row['raw'].encode()).hexdigest()
                for row in data['files'] if not row['deleted']}
    if hashes != expected:
        raise ValueError('Local checksum manifest mismatch')
    files = {}

    def add(relative, path, expected_hash=None):
        if path.is_symlink() or not path.resolve(strict=True).is_relative_to(state.resolve()):
            raise ValueError('Invalid local backup file')
        digest, size = digest_file(path)
        if expected_hash is not None and digest != expected_hash:
            raise ValueError('Local backup checksum mismatch')
        files[relative] = (path, digest, size)

    for relative, digest in expected.items():
        add(relative, snapshot / relative, digest)
    for name in ('export.json', 'sha256.json'):
        add(name, snapshot / name)
    for row in data['revisions']:
        relative = str(PurePosixPath('revisions', row['revision'], relative_path(row['path']).as_posix()))
        add(relative, state / relative, hashlib.sha256(row['raw'].encode()).hexdigest())
    return files


def directory(ftp, path):
    path = safe_path(str(path))
    if path.is_absolute():
        ftp.cwd('/')
    for part in path.parts:
        if part == '/':
            continue
        try:
            ftp.cwd(part)
        except ftplib.error_perm as error:
            if not str(error).startswith('550'):
                raise
            ftp.mkd(part)
            ftp.cwd(part)


def transfer(config, files, factory=BackupFTPS):
    ftp = factory(context=tls_context(config), timeout=30, encoding='utf-8')
    # Never connect to the address advertised by PASV instead of the NAS itself.
    ftp.trust_server_pasv_ipv4_address = False
    try:
        ftp.connect(config['host'], config.get('port', 21))
        ftp.auth()
        ftp.login(config['username'], config['password'])
        ftp.prot_p()
        ftp.set_pasv(True)
        directory(ftp, config['directory'])
        root = safe_path(ftp.pwd())
        if not root.is_absolute():
            raise ValueError('Expected absolute FTP working directory')
        stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ') + '-' + uuid.uuid4().hex[:8]
        pending = root / ('.incomplete-' + stamp)
        complete = root / stamp
        ftp.mkd(str(pending))
        for relative, (path, expected_hash, expected_size) in sorted(files.items()):
            target = safe_path(relative)
            if target.is_absolute():
                raise ValueError('Invalid backup file path')
            ftp.cwd(str(pending))
            directory(ftp, target.parent)
            with path.open('rb') as source:
                ftp.storbinary('STOR ' + target.name, source, blocksize=65536)
            digest = hashlib.sha256()
            size = 0

            def verify(chunk):
                nonlocal size
                size += len(chunk)
                if size > expected_size:
                    raise ValueError('NAS verification exceeded expected size')
                digest.update(chunk)

            ftp.retrbinary('RETR ' + target.name, verify, blocksize=65536)
            if size != expected_size or digest.hexdigest() != expected_hash:
                raise ValueError('NAS checksum verification failed')
        # A completed directory is visible only after every file was read back.
        ftp.rename(str(pending), str(complete))
        return complete.name
    finally:
        try:
            ftp.quit()
        except Exception:
            pass
        finally:
            ftp.close()


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, default=Path('/etc/leodeng-content-backup/ftps.json'))
    parser.add_argument('--state', type=Path, default=Path('/var/lib/leodeng-content'))
    args = parser.parse_args()
    try:
        config = load_config(args.config)
        complete = transfer(config, snapshot_files(args.state))
    except Exception as error:
        # Server errors and configuration values can contain private information.
        print(f'FTPS backup failed ({type(error).__name__}); no completed backup published.', file=sys.stderr)
        return 1
    print(f'Verified FTPS content backup saved: {complete}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
