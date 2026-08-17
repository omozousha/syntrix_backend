# Progress

**What works**

- Full WebP image standard on upload, storage, DB metadata (`original_name`/`extension` = `.webp`), and download across all photo pages.
- Batch migration script `scripts/migrate-existing-images.js` run in production: 882 images optimized, 168 existing `original_name` backfilled, device `image_attachments` JSONB synced.

**Not started / backlog**

- Backfill `image_attachments` JSONB WebP metadata across `pops`, `projects`, `validation_requests` (only `devices` synced so far).

**Known issues**

- 

_Keep bullets factual and small; link issues or PRs when useful._
