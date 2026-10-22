# Active context

**Current focus** (one short paragraph):
Fix monthly validation progress SQL range calculation in `dashboard.service.js` where `endDate` mistakenly passed `selectedMonth` instead of `selectedYear` to `Date.UTC`. Pushed commit `d040576` to `main` for Vercel production deployment.

**In progress**:

- [x] Fix `getValidationProgress` in `dashboard.service.js` (`selectedYear` for `endDate` in monthly view)
- [x] Push backend to `main` to trigger Vercel deployment
- [ ] (backlog) Backfill `image_attachments` WebP metadata on `pops`, `projects`, `validation_requests`

**Decisions (recent)**:

- `getValidationProgress`: `endDate` for monthly view uses `Date.UTC(selectedYear, selectedMonth, 0)` to correctly resolve the last day of the target month in the current year.
- `original_name`/`extension` always saved as `.webp` on image upload (`resource.routes.js`); legacy rows backfilled.
- Frontend download and display of image filenames always normalize to `.webp` (`attachment-utils.ts`, `evidence-checklist-preview.tsx`).
- Convention: new image features must use `/attachments/upload`, `<OptimizedImage />`, and `downloadAttachmentFile()`.

**Open questions**:

- 

_Update when the task or branch focus changes._
