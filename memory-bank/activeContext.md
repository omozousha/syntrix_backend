# Active context

**Current focus** (one short paragraph):
WebP full-stack standardization is complete and deployed. All new image flows must reuse the established pipeline (Sharp → Nhost → `<OptimizedImage />` → `downloadAttachmentFile()` with `.webp` enforcement).

**In progress**:

- [ ] (backlog) Backfill `image_attachments` WebP metadata on `pops`, `projects`, `validation_requests`

**Decisions (recent)**:

- `original_name`/`extension` always saved as `.webp` on image upload (`resource.routes.js`); legacy rows backfilled.
- Frontend download and display of image filenames always normalize to `.webp` (`attachment-utils.ts`, `evidence-checklist-preview.tsx`).
- Convention: new image features must use `/attachments/upload`, `<OptimizedImage />`, and `downloadAttachmentFile()`.

**Open questions**:

- 

_Update when the task or branch focus changes._
