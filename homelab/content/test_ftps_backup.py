import contextlib
import ftplib
import json
from pathlib import Path, PurePosixPath
import shutil
import socketserver
import ssl
import subprocess
import tempfile
import threading
import unittest
from unittest.mock import patch, Mock

import export
import ftps_backup as backup


def payload():
    post = {'path': 'src/posts/a.md', 'raw': '---\r\ntitle: 中文\r\n---\r\nHello\r\n',
            'revision': '11111111-1111-4111-8111-111111111111', 'deleted': 0}
    shelf = {'path': 'src/content/shelf.json', 'raw': '{"items":[]}',
             'revision': '22222222-2222-4222-8222-222222222222', 'deleted': 0}
    return {'version': 1, 'files': [post, shelf], 'revisions': [post, shelf]}


class FakeFTP:
    def __init__(self, corrupt=False, fail_upload=False, fail_auth=False):
        self.position = PurePosixPath('/')
        self.directories = {'/'}
        self.files = {}
        self.events = []
        self.corrupt, self.fail_upload, self.fail_auth = corrupt, fail_upload, fail_auth
        self.closed = False

    def path(self, value):
        path = PurePosixPath(value)
        return str(path if path.is_absolute() else self.position / path)

    def connect(self, *args): self.events.append('connect')
    def auth(self):
        self.events.append('auth')
        if self.fail_auth: raise ssl.SSLCertVerificationError('test certificate failure')
    def login(self, *args): self.events.append('login')
    def prot_p(self): self.events.append('protect')
    def set_pasv(self, value): self.events.append(('passive', value))
    def pwd(self): return str(self.position)
    def cwd(self, value):
        target = self.path(value)
        if target not in self.directories: raise ftplib.error_perm('550 No directory')
        self.position = PurePosixPath(target)
    def mkd(self, value):
        target = self.path(value)
        if target in self.directories: raise ftplib.error_perm('550 Already exists')
        self.directories.add(target)
    def storbinary(self, cmd, source, **options):
        if self.fail_upload: raise OSError('interrupted')
        self.files[self.path(cmd.removeprefix('STOR '))] = source.read()
    def retrbinary(self, cmd, callback, **options):
        data = self.files[self.path(cmd.removeprefix('RETR '))]
        callback(data + b'corrupt' if self.corrupt else data)
    def rename(self, old, new): self.events.append(('rename', old, new))
    def quit(self): self.events.append('quit')
    def close(self): self.closed = True


class TransferTests(unittest.TestCase):
    def test_snapshot_and_remote_verification_preserve_original_markdown_and_revisions(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            export.save_export(payload(), state)
            files = backup.snapshot_files(state)
            ftp = FakeFTP()
            with patch.object(backup, 'tls_context', return_value=ssl.create_default_context()):
                name = backup.transfer({'host': 'nas.example.test', 'username': 'test-user', 'password': 'test-only', 'directory': '/备份/website'}, files, factory=lambda **kw: ftp)
            self.assertTrue(ftp.closed)
            self.assertEqual(ftp.events[:4], ['connect', 'auth', 'login', 'protect'])
            self.assertFalse(ftp.trust_server_pasv_ipv4_address)
            self.assertEqual(len(ftp.files), len(files))
            self.assertEqual(len(files), 6)
            self.assertEqual(next(data for path, data in ftp.files.items() if path.endswith('/posts/a.md')), payload()['files'][0]['raw'].encode())
            self.assertEqual(ftp.events[-2], ('rename', '/备份/website/.incomplete-' + name, '/备份/website/' + name))
            self.assertEqual(ftp.events[-1], 'quit')

    def test_errors_never_publish_complete_snapshot_and_always_disconnect(self):
        for options in ({'corrupt': True}, {'fail_upload': True}, {'fail_auth': True}):
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                state = Path(directory)
                export.save_export(payload(), state)
                ftp = FakeFTP(**options)
                with patch.object(backup, 'tls_context', return_value=ssl.create_default_context()):
                    with self.assertRaises((ValueError, OSError)):
                        backup.transfer({'host': 'nas.example.test', 'username': 'test-user', 'password': 'test-only', 'directory': '/backup'}, backup.snapshot_files(state), factory=lambda **kw: ftp)
                self.assertTrue(ftp.closed)
                self.assertFalse(any(isinstance(e, tuple) and e[0] == 'rename' for e in ftp.events))
                if options.get('fail_auth'): self.assertNotIn('login', ftp.events)

    def test_bad_local_snapshot_fails_before_connection(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            export.save_export(payload(), state)
            (state / 'latest/posts/a.md').write_text('corrupt')
            with self.assertRaises(ValueError): backup.snapshot_files(state)
            for value in ('../escape', '/backup/../escape', '/backup\r\nDELE file'):
                with self.assertRaises(ValueError): backup.safe_path(value)

    def test_config_requires_private_file_and_tls_identity_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'config.json'
            config.write_text(json.dumps({'host': 'nas.example.test', 'username': 'test-user', 'password': 'test-only', 'ca_file': 'ca.pem', 'directory': '/backup'}))
            config.chmod(0o644)
            with self.assertRaises(ValueError): backup.load_config(config)
            config.chmod(0o600)
            self.assertEqual(backup.load_config(config)['host'], 'nas.example.test')

    def test_data_channels_require_protection_and_reuse_tls_session(self):
        client = backup.BackupFTPS(context=ssl.create_default_context())
        with self.assertRaises(ValueError): client.ntransfercmd('RETR file')
        client._prot_p = True
        client.host = 'nas.example.test'
        client.sock = Mock()
        connection = Mock()
        context = Mock()
        client.context = context
        with patch.object(ftplib.FTP, 'ntransfercmd', return_value=(connection, 10)):
            client.ntransfercmd('RETR file')
        context.wrap_socket.assert_called_once_with(connection, server_hostname=client.host, session=client.sock.session)
        context.wrap_socket.side_effect = ssl.SSLError('test data TLS failure')
        with patch.object(ftplib.FTP, 'ntransfercmd', return_value=(connection, 10)):
            with self.assertRaises(ssl.SSLError): client.ntransfercmd('RETR file')
        connection.close.assert_called_once()


@unittest.skipUnless(shutil.which('openssl'), 'OpenSSL needed for local certificate integration tests')
class CertificateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        for name in ('nas', 'other'):
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                            '-keyout', str(cls.root / (name + '.key')), '-out', str(cls.root / (name + '.pem')),
                            '-subj', '/CN=test-nas', '-addext', 'subjectAltName=IP:127.0.0.1'], check=True,
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    @classmethod
    def tearDownClass(cls): cls.temporary.cleanup()

    @contextlib.contextmanager
    def server(self):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(self.root / 'nas.pem', self.root / 'nas.key')
        events = []

        class Handler(socketserver.BaseRequestHandler):
            def handle(self):
                connection = self.request
                connection.settimeout(3)
                try:
                    connection.sendall(b'220 Test FTPS\r\n')
                    reader = connection.makefile('rb')
                    events.append(reader.readline().strip())
                    connection.sendall(b'234 Start TLS\r\n')
                    reader.close()
                    connection = context.wrap_socket(connection, server_side=True)
                    reader = connection.makefile('rb')
                    while command := reader.readline():
                        verb = command.split()[0]
                        events.append(verb)
                        connection.sendall({b'USER': b'331 Password\r\n', b'PASS': b'230 Logged in\r\n',
                                            b'QUIT': b'221 Goodbye\r\n'}.get(verb, b'200 OK\r\n'))
                        if verb == b'QUIT': break
                    reader.close()
                except (ssl.SSLError, OSError):
                    pass
                finally:
                    connection.close()

        with socketserver.ThreadingTCPServer(('127.0.0.1', 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .02}, daemon=True)
            thread.start()
            try: yield server.server_address[1], events
            finally:
                server.shutdown()
                thread.join(timeout=4)

    def test_explicit_tls_trusts_local_certificate_and_protects_before_credentials(self):
        config = {'ca_file': str(self.root / 'nas.pem')}
        context = backup.tls_context(config)
        self.assertTrue(context.check_hostname)
        self.assertFalse(context.hostname_checks_common_name)
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        with self.server() as (port, events):
            with backup.BackupFTPS(context=context, timeout=3) as client:
                client.connect('127.0.0.1', port)
                client.auth()
                client.login('test-user', 'test-only')
                client.prot_p()
            self.assertEqual(events, [b'AUTH TLS', b'USER', b'PASS', b'PBSZ', b'PROT', b'QUIT'])

    def test_wrong_certificate_or_wrong_hostname_never_sends_credentials(self):
        for host, ca in [('127.0.0.1', 'other.pem'), ('localhost', 'nas.pem')]:
            with self.subTest(host=host), self.server() as (port, events):
                client = backup.BackupFTPS(context=backup.tls_context({'ca_file': str(self.root / ca)}), timeout=3)
                try:
                    client.connect(host, port)
                    with self.assertRaises(ssl.SSLCertVerificationError): client.auth()
                finally: client.close()
                self.assertEqual(events, [b'AUTH TLS'])


if __name__ == '__main__': unittest.main()
