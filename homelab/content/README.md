# Content exports and backups

Blog posts, drafts and shelf entries are stored in D1. Uploaded media stays in
R2. Content saves are versioned and do not require a site deployment.

`export.py` validates a content export and saves Markdown, shelf JSON, checksums
and immutable revision files locally. An atomic symlink selects the latest
completed snapshot. An invalid export never replaces a previous valid copy.

`ftps_backup.py` copies a snapshot and its revisions over explicit FTPS. Both
the control and passive data channels require TLS. Certificate-chain and
hostname verification use a client-specific trust file. There is no plaintext
fallback or SMB mount.

Each transfer uses a new incomplete directory. Every uploaded file is downloaded
and checked for its expected size and SHA-256 digest before the directory is
renamed as complete. Failures leave the incomplete directory for inspection and
preserve previous backups. Connections close after each attempt.

The local export timer runs independently of NAS transfers. The daily NAS timer
retains its existing schedule and retry behavior. Snapshots are not automatically
pruned. Backups contain media references, not the R2 media bytes themselves.

Operator configuration, credentials, installation and recovery instructions are
kept outside tracked documentation.

Run the standard-library tests with:

```sh
python3 -m unittest discover -s homelab/content -p 'test_*.py'
```
