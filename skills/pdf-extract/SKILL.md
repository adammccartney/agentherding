---
name: pdf-extract
description: "Extract page ranges or whole chapters from a PDF book to plain text using the text layer. Use when the task is to pull chapter N, a section, or quoted pages out of a PDF file."
---

Extract a page range of a PDF to plain text via `pypdf` (text layer only; scanned images produce empty pages - say so instead of writing silent blanks).

## Tooling

`scripts/extract_pages.py` (run with `uv run`; bundled dependencies are declared in the script header).

```
uv run scripts/extract_pages.py <in.pdf> <out.txt> <start 1-based incl> <end 1-based excl>
uv run scripts/extract_pages.py <in.pdf> --peek <page> [width]
uv run scripts/extract_pages.py <in.pdf> --find <regex> [from] [to]
```

Modes:

- **extract (default)** - dump pages [start, end) with `=== pdf page N ===` markers.
- **--peek** - print the head lines of one page; use it to confirm a candidate chapter-opener *before* committing to a range.
- **--find** - list pages matching a regex with matching-line previews; use it to *locate* candidates, then verify with --peek (do not trust it for boundaries).

## Workflow for extracting a chapter

1. Locate the chapter's spread: `--find '^chapter <N>'` yields candidates.
2. Confirm the real opener with `--peek` on each candidate: a true chapter-start page shows the chapter title and the first prose paragraph, not mid-flow content. Beware running headers repeating "CHAPTER N" mid-chapter (books echo the chapter title in page furniture).
3. Repeat for chapter `<N+1>` to find the exclusive end page.
4. Extract: `--extract` writes one file; page markers ride along for traceability.

## Invariants

- Output is plain text in reading order; keep the `=== pdf page N ===` markers so downstream consumers can trace quotes back to pages.
- Head lines may include running headers/footers; verify with --peek, never by regex alone.
- If a chapter's page comes back empty or garbled, the PDF is scanned: stop, report it, and suggest OCR (tesseract) instead of dumping blanks.
