# Archived nuclear VLM workflow

The nuclear-medicine PDF importer now exclusively registers the matching appendix PDF pages. The former Qwen3-VL individual-figure workflow was removed from the application UI and Electron startup path in July 2026.

This directory preserves the previous implementation for reference:

- client-side grouping and server provider code;
- the former API route;
- Electron model download and sidecar management;
- pinned model manifests and preparation scripts;
- implementation notes and focused tests.

Nothing in this directory is included in the active application flow. Restoring it requires an explicit new integration rather than a UI flag change.
