# Evidence Workspace

## Purpose

The Reports navigation entry opens the Evidence Workspace. It reviews Evidence Bundles and derived reports; it does not execute campaigns.

## Explorer

Operators can inspect bundles by campaign, run, date, environment, status, and bundle type. Search, sort, and type filters operate on existing API data. The explorer scrolls independently from the detail pane.

## Bundle Detail

The workspace shows:

- campaign and run identity
- environment and bundle type
- item count and total bytes
- storage backend, prefix, and upload state
- checksum/integrity metadata
- retention class
- related artifacts and reports

## Evidence Items And Preview

Evidence Item metadata includes relative path, type, content type, size, SHA-256, sensitivity, rendering policy, storage key, and upload state. Supported previews use existing authenticated routes for HTML, JSON, text, Markdown, images, and video where the item is allowed. Trace ZIPs and other binaries remain download-oriented.

Playwright reports use the bundle route so CSS, JavaScript, images, attachments, traces, and other relative assets resolve under the authenticated bundle root.

## Evidence Chain

```text
Campaign -> Run -> Evidence Bundle -> Evidence Items -> Reports -> SIEM Export
```

Artifact metadata remains the compatibility link for existing APIs. Reports are derived views and never replace source evidence.

## Security

- Every artifact and bundle request requires an authenticated viewer or higher.
- Request paths are resolved from metadata, not arbitrary client paths.
- Canonical `realpath` validation rejects traversal, symlink escape, and directory escape.
- Textual responses apply output redaction.
- Supabase Storage remains private and is not exposed through browser-direct URLs.

## Not Implemented

- retention and deletion controls
- archive/restore workflows
- direct Supabase Storage serving
- cross-run full-text evidence search
- evidence mutation from the UI
