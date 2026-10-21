# /// script
# dependencies = ["pypdf"]
# ///
"""Extract a page range of a PDF to plain text (text layer only).

Usage:
    uv run extract_pages.py <in.pdf> <out.txt> <start 1-based incl> <end 1-based excl>
    uv run extract_pages.py <in.pdf> --peek <page 1-based> [<width>]
    uv run extract_pages.py <in.pdf> --find <needle-regex> [<from 1-based>] [<to 1-based>]

Modes:
    extract (default) - dump pages [start, end) with page markers.
    --peek            - print the head lines of one page (for hunting
                        chapter boundaries before committing to a range).
    --find            - list pages whose text matches a regex, with the
                        first matching lines as preview.

Notes:
- Scanned-image PDFs produce empty pages; say so instead of writing
  blank output silently.
"""
import re
import sys

from pypdf import PdfReader


def cmd_peek(reader, page, width):
    text = reader.pages[page - 1].extract_text() or ""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()][:10]
    print(f"--- pdf page {page}:")
    for ln in lines:
        print("   ", ln[:width])


def cmd_find(reader, needle, start, end):
    for i in range(start - 1, end):
        text = reader.pages[i].extract_text() or ""
        hits = [ln.strip() for ln in text.splitlines() if ln.strip() and needle.search(ln)]
        if hits:
            print(f"  p{i + 1}: {' | '.join(hits[:3])[:120]}")


def cmd_extract(reader, out_path, start, end):
    if not (1 <= start < end <= len(reader.pages) + 1):
        print(f"range {start}..{end} out of 1..{len(reader.pages)}", file=sys.stderr)
        return 2
    parts = []
    for i in range(start - 1, end - 1):
        text = reader.pages[i].extract_text() or ""
        parts.append(f"\n=== pdf page {i + 1} ===\n{text}")
    with open(out_path, "w") as fh:
        fh.write("\n".join(parts))
    print(f"{out_path}: pages {start}-{end - 1} ({end - start} pages)", file=sys.stderr)
    return 0


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    path = argv[1]
    mode = argv[2]
    reader = PdfReader(path)

    if mode == "--peek":
        width = int(argv[4]) if len(argv) > 4 else 90
        cmd_peek(reader, int(argv[3]), width)
        return 0
    if mode == "--find":
        needle = re.compile(argv[3], re.IGNORECASE)
        start = int(argv[4]) if len(argv) > 4 else 1
        end = int(argv[5]) - 1 if len(argv) > 5 else len(reader.pages)
        cmd_find(reader, needle, start, end)
        return 0

    out_path = argv[2]
    start = int(argv[3])
    end = int(argv[4])
    return cmd_extract(reader, out_path, start, end)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
