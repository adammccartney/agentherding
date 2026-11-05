---
name: colab
description: "Read-only TU coLAB (Confluence) docs: spaces, CQL search, page fetch via bin/cb — use when the user asks to find or read pages on colab.tuwien.ac.at"
---

Use `bin/cb` to find and read TU coLAB pages without editing them.

## Verbs

- `bin/cb spaces [--limit 25]` lists space keys, names, and types.
- `bin/cb search '<cql>' [--limit 5]` runs the supplied CQL verbatim and lists
  page/content IDs, titles, spaces, and types.
- `bin/cb get <id>` prints metadata and the page body converted from HTML to text.
  Add `--json` to any verb for structured output.

CQL examples:

```bash
# Full-text search
bin/cb search 'siteSearch ~ "gateway"'

# Scoped search
bin/cb search 'space=ASC AND title ~ "modules" AND type=page'

# Read a result
bin/cb get 1234567
```

Useful spaces: `ASC` (ASC), `VSC` (ASC Operations), `ADLS`, `vsciso2k`
(ASC ISO27k), and `ABOUT`.

## Hard rules

- **GET-only:** never edit pages, page history, comments, or attachments by any route.
- Never use `curl` with tokens or print token values. Keep the raw token at
  `~/.config/colab/token` with mode `0600`.
- `COLAB_TOKEN` overrides the token file; `COLAB_TOKEN_FILE` overrides its path;
  `COLAB_BASE_URL` overrides `https://colab.tuwien.ac.at`.
- Page bodies stop after 4000 text characters and carry an explicit cap marker.
  Narrow the CQL query or read the page in coLAB when the cap omits needed detail.
