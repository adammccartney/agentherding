#!/usr/bin/env bash
#
# Helper script for creating git commits
# Usage: ./scripts/commit.sh [-f <file>]... -m <message> [-b <body>] [-c <co-author>]...
#

set -euo pipefail

FILES=()
FILE_COUNT=0
MESSAGE=""
BODY=""
CO_AUTHORS=()
CO_AUTHOR_COUNT=0

while getopts "f:m:b:c:h" opt; do
    case $opt in
        f)
            FILES[FILE_COUNT]="$OPTARG"
            FILE_COUNT=$((FILE_COUNT + 1))
            ;;
        m) MESSAGE="$OPTARG" ;;
        b) BODY="$OPTARG" ;;
        c)
            CO_AUTHORS[CO_AUTHOR_COUNT]="$OPTARG"
            CO_AUTHOR_COUNT=$((CO_AUTHOR_COUNT + 1))
            ;;
        h)
            printf 'Usage: %s [-f <file>]... -m <message> [-b <body>] [-c <co-author>]...\n' "$0"
            printf '  -f  File to stage (can be repeated)\n'
            printf '  -m  Commit message (required)\n'
            printf '  -b  Optional body text\n'
            printf '  -c  Text after Co-Authored-by: (can be repeated)\n'
            exit 0
            ;;
        \?)
            printf 'Invalid option: -%s\n' "$OPTARG" >&2
            exit 1
            ;;
    esac
done
shift "$((OPTIND - 1))"

if [[ $# -gt 0 ]]; then
    printf 'Error: unexpected positional operand: %q\n' "$1" >&2
    printf 'Usage: %s [-f <file>]... -m <message> [-b <body>] [-c <co-author>]...\n' "$0" >&2
    exit 1
fi

if [[ -z "$MESSAGE" ]]; then
    printf 'Error: Commit message is required (-m)\n' >&2
    exit 1
fi

validate_staged_selection() {
    local staged_path selected_file selected unexpected=0

    if ! git diff --cached --name-only -z | {
        while IFS= read -r -d '' staged_path; do
            selected=0
            for selected_file in "${FILES[@]}"; do
                if [[ "$staged_path" == "$selected_file" ]]; then
                    selected=1
                    break
                fi
            done
            if [[ $selected -eq 0 ]]; then
                printf 'Error: staged path outside explicit -f selection: %q\n' \
                    "$staged_path" >&2
                unexpected=1
            fi
        done
        [[ $unexpected -eq 0 ]]
    }; then
        printf 'Commit aborted; reconcile the staged paths above before retrying.\n' >&2
        return 1
    fi
}

# Reflow only ordinary prose. Structural lines pass through unchanged.
format_body() {
    awk '
        function flush_paragraph(    count, words, word_index, word, line) {
            if (paragraph == "") {
                return
            }

            count = split(paragraph, words, /[[:space:]]+/)
            line = ""
            for (word_index = 1; word_index <= count; word_index++) {
                word = words[word_index]
                if (word == "") {
                    continue
                }
                if (line == "") {
                    line = word
                } else if (length(line) + 1 + length(word) <= 72) {
                    line = line " " word
                } else {
                    print line
                    line = word
                }
            }
            if (line != "") {
                print line
            }
            paragraph = ""
        }

        function is_structural(line) {
            return line ~ /^[[:space:]]/ ||
                line ~ /^([-+*]|[0-9]+[.)])[[:space:]]+/ ||
                line ~ /^[A-Za-z][A-Za-z0-9-]*:[[:space:]]/ ||
                line ~ /^>/
        }

        function strip_fence_indent(line) {
            if (substr(line, 1, 3) == "   ") {
                return substr(line, 4)
            }
            if (substr(line, 1, 2) == "  ") {
                return substr(line, 3)
            }
            if (substr(line, 1, 1) == " ") {
                return substr(line, 2)
            }
            return line
        }

        BEGIN {
            paragraph = ""
            in_fence = 0
            fence_char = ""
            fence_len = 0
        }

        {
            if (in_fence) {
                print $0

                stripped = strip_fence_indent($0)
                run = 0
                while (substr(stripped, run + 1, 1) == fence_char) {
                    run++
                }
                if (run >= fence_len && substr(stripped, run + 1) ~ /^[ ]*$/) {
                    in_fence = 0
                }
                next
            }

            if ($0 ~ /^[[:space:]]*$/) {
                flush_paragraph()
                print $0
                next
            }

            stripped = strip_fence_indent($0)
            if (substr(stripped, 1, 3) == "```" ||
                    substr(stripped, 1, 3) == "~~~") {
                flush_paragraph()
                print $0
                fence_char = substr(stripped, 1, 1)
                fence_len = 0
                while (substr(stripped, fence_len + 1, 1) == fence_char) {
                    fence_len++
                }
                in_fence = 1
                next
            }

            if (is_structural($0)) {
                flush_paragraph()
                print $0
                next
            }

            paragraph = paragraph (paragraph == "" ? "" : " ") $0
        }

        END {
            flush_paragraph()
        }
    '
}

if [[ $FILE_COUNT -gt 0 ]]; then
    validate_staged_selection
    printf 'Staging files:'
    printf ' %q' "${FILES[@]}"
    printf '\n'
    git add -- "${FILES[@]}"
fi

COMMIT_ARGS=(-m "$MESSAGE")
if [[ -n "$BODY" ]]; then
    FORMATTED_BODY="$(printf '%s\n' "$BODY" | format_body)"
    COMMIT_ARGS+=(-m "$FORMATTED_BODY")
fi
if [[ $CO_AUTHOR_COUNT -gt 0 ]]; then
    for CO_AUTHOR in "${CO_AUTHORS[@]}"; do
        COMMIT_ARGS+=(-m "Co-Authored-by: $CO_AUTHOR")
    done
fi

printf 'Creating commit...\n'
git commit "${COMMIT_ARGS[@]}"

printf 'Commit created successfully; inspecting metadata:\n'
git show -s --format='Author: %an <%ae>%nCommitter: %cn <%ce>%nSubject: %s' HEAD
