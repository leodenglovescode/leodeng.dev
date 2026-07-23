# Planespotting photos

Drop `.jpg` / `.jpeg` / `.png` / `.webp` files in this folder and rebuild —
`Gallery.vue` glob-imports everything here automatically, no manifest to edit.

Sort order is alphabetical by filename. Prefix with a number (`01-`, `02-`, ...)
if you want to control the order, or name them by date (`2026-07-23-...`).

The caption shown under each photo (and in the lightbox): filenames in the
`YYYY-MM-DD_HH-mm-ss` format (see below) render as "Shot on 2025 Aug 3
15:39:30". Any other filename falls back to the extension stripped and
`-`/`_` replaced with spaces, e.g. `sfo-737-sunset.jpg` → "sfo 737 sunset".

## Auto-naming by date

```bash
npm run photos:rename          # preview only, no changes
npm run photos:rename:apply    # renames files in place
```

`photos:rename` defaults to a dry run and prints what it *would* do. Nothing
is renamed until you run `photos:rename:apply`.

Renames every photo here to `YYYY-MM-DD_HH-mm-ss.ext`, which also gives them a
chronological sort order in the gallery. Date is picked in this priority:

1. EXIF capture date (`DateTimeOriginal`/`CreateDate`)
2. File's last-modified time, if EXIF is missing/unreadable
3. File's last-accessed time, if mtime is unavailable

Files already in the `YYYY-MM-DD_HH-mm-ss` format are skipped. Collisions
(same second) get a `-2`, `-3`, ... suffix.
