# Live content and Markdown backups

Blog posts, private drafts and shelf entries live in the existing `HOMELAB_DB`
D1 binding. Uploaded media stays in R2. The site's code still deploys from Git.
Production editor saves do not make Git commits or trigger deployments.

## Initial migration

1. Generate the private SQL seed with `npm run content:migrate`.
2. Apply `.local-admin/content-migration.sql` to `leodeng-homelab` with
   `wrangler d1 execute leodeng-homelab --remote --file .local-admin/content-migration.sql`.
3. Deploy the updated Functions and frontend together.

The seed includes published Markdown, drafts and `src/content/shelf.json`.
It validates all entries before producing SQL. Reapplying it never overwrites
an existing D1 entry, including a deleted entry. The ready marker is written
last. Original repository files remain as an initial static fallback and local
development content. They are not updated by production saves. Once D1 is live,
do not edit those files expecting to update the production blog or shelf.

Every save has an opaque revision ID. An update, rename, publication or deletion
requires the editor's current revision. D1 atomically records the change and
its revision snapshot; another tab's stale edit gets a conflict instead of
silently overwriting it. Renaming a post does not create a redirect from its
old URL. Prefer keeping a published slug stable.

Public endpoints select published, undeleted rows only. Drafts, deleted content
and the revision archive require the allowlisted GitHub session, or the dedicated
read-only backup token on the export endpoint. The backup token cannot edit or
list private content through the editor endpoints. Production has no local-login
bypass. Local `npm run dev` retains its existing filesystem editor and HMR.

Both modern and classic blog pages, shelf pages, RSS, sitemap, `llms.txt` and
published `/blog/<slug>.md` URLs read current D1 content. The classic site renders
HTML on the server, including its static Mermaid SVGs. It does not need Vue or
JavaScript to read new posts. Reopening a page reads current content; opening the
blog also refreshes the client list. An already-open post is not a collaborative
live editor.

## Secrets

Set a random `CONTENT_BACKUP_TOKEN` on the production Pages project `leodeng-dev`.
It is separate from the GitHub login and other telemetry tokens. Keep the same
value in `/etc/leodeng-content-backup/token` (root-owned, mode 600).

The installer can copy `.local-admin/content-backup-token` if it was prepared
on this machine. Otherwise it prompts for the token. Never commit the token,
SQL seed, exported drafts or SMB credentials. `.local-admin/` is ignored.

## Install on SuperServer

Install `cifs-utils` and `util-linux` first if they are missing, then run:

```bash
sudo bash homelab/content/install.sh
```

The installer prompts for the NAS SMB username and password without echoing the
password. Credentials are stored only in the root-owned mode-600 file
`/etc/leodeng-content-backup/smb.credentials`. Re-running the installer preserves
existing credentials and configuration. To replace credentials, edit that file
with a root editor. The password is never placed in process arguments.

The configured destination is:

- Share: `//192.168.3.17/leodeng_存储空间1`
- Folder inside share: `ALL/website_blogs_backup`

These live in `/etc/leodeng-content-backup/nas.conf`. The share uses SMB 3;
there is no FTP transfer and no permanent mount or fstab entry.

The installer performs a first local export and NAS backup immediately, so
incorrect credentials are discovered during setup rather than at midnight.
It then enables two timers:

- `content-export.timer`: export to local disk every five minutes, without
  contacting or waking the NAS. Unchanged exports reuse the previous snapshot.
- `content-nas-backup.timer`: NAS copy daily at **00:00 Asia/Shanghai**. After
  downtime a persistent timer catches up at the next boot. Failed copies retry
  after an hour, up to three attempts in 12 hours; successful jobs do not retry.

## What is retained

`/var/lib/leodeng-content/latest/` points to the latest completed local export:

- `posts/*.md`: original Markdown, with frontmatter.
- `drafts/*.md`: unpublished Markdown, kept private.
- `shelf.json`: movies, TV shows and albums with their IDs and links.
- `export.json`: current rows, deleted markers and all revision snapshots.
- `sha256.json`: checksums for the current Markdown and shelf JSON files.

`revisions/<revision-id>/posts/*.md` (or `drafts/*.md`, or `shelf.json`) retains
standalone copies of every saved version. This includes an entry that is edited
and deleted between exports: D1 retains those revisions until they are exported.
Local changed snapshots and dated NAS directories are not automatically pruned.
An incomplete download never replaces `latest`.

The NAS job mounts the share under `/run/leodeng-content-nas/share` only for the
copy, validates the copied Markdown/JSON checksums and renames its temporary
directory only after verification, then unmounts. A failed mount cannot write a
fake backup into the local mount directory. This job performs no NAS health
checks between scheduled attempts, allowing the NAS's own sleep settings to
apply. It wakes the disks when the actual backup runs.

Backups include the shelf's image URLs and R2 keys, not the media bytes. This is
a content backup; R2 media backups are a separate concern. RAID 1 mirrors the NAS
disks, while the dated directories provide protection against ordinary edits
and deletions.

## Inspect or run manually

```bash
sudo systemctl start content-export.service
sudo systemctl start content-nas-backup.service
systemctl list-timers content-export.timer content-nas-backup.timer
sudo journalctl -u content-export.service -u content-nas-backup.service -n 40
sudo ls /var/lib/leodeng-content/latest/posts
```

Errors are visible in systemd's failed unit status and journal. These units do
not send external notifications.

## Recovery

Every `.md` can be read or pasted back into the editor. A full export can be
materialized again without network access:

```bash
sudo /usr/local/bin/leodeng-content-export \
  --from-file /path/to/backup/export.json \
  --destination /var/lib/leodeng-content-recovered
```

This command writes local files only. It does not modify D1. For a deleted post,
use its earlier file under `revisions/` or a dated snapshot, then publish it in
the editor. D1 Time Travel is another recovery option, separate from the NAS.
