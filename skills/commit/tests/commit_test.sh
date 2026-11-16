#!/usr/bin/env bash

set -euo pipefail

TEST_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
TEST_SCRIPT="$TEST_DIR/commit_test.sh"
HELPER="$TEST_DIR/../scripts/commit.sh"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/commit-skill-test.XXXXXX")"
cleanup() {
    rm -rf -- "$TEST_ROOT"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

HOME="$TEST_ROOT/home"
XDG_CONFIG_HOME="$TEST_ROOT/config"
GIT_CONFIG_GLOBAL=/dev/null
GIT_CONFIG_NOSYSTEM=1
export HOME XDG_CONFIG_HOME GIT_CONFIG_GLOBAL GIT_CONFIG_NOSYSTEM
mkdir -p -- "$HOME" "$XDG_CONFIG_HOME"
unset GIT_AUTHOR_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_NAME GIT_COMMITTER_EMAIL
unset GIT_AUTHOR_DATE GIT_COMMITTER_DATE GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE
unset GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0 GIT_CONFIG_PARAMETERS

FIXTURE="$TEST_ROOT/repo"
git init -q "$FIXTURE"
cd "$FIXTURE"
git config user.name 'Fixture Human'
git config user.email 'fixture.human@example.invalid'
git config commit.gpgsign false

PASS_COUNT=0

fail() {
    printf 'not ok - %s\n' "$1" >&2
    exit 1
}

assert_eq() {
    local expected="$1"
    local actual="$2"
    local label="$3"
    if [[ "$actual" != "$expected" ]]; then
        printf 'Assertion failed: %s\nExpected:\n%s\nActual:\n%s\n' \
            "$label" "$expected" "$actual" >&2
        fail "$label"
    fi
}

assert_log_excludes() {
    local needle="$1"
    local file="$2"
    local label="$3"
    if grep -Fq -- "$needle" "$file"; then
        fail "$label"
    fi
}

assert_log_includes() {
    local needle="$1"
    local file="$2"
    local label="$3"
    if ! grep -Fq -- "$needle" "$file"; then
        cat "$file" >&2
        fail "$label"
    fi
}

run_test() {
    local name="$1"
    shift
    "$@"
    PASS_COUNT=$((PASS_COUNT + 1))
    printf 'ok %d - %s\n' "$PASS_COUNT" "$name"
}

test_syntax_and_no_external_formatter() {
    bash -n "$HELPER"
    bash -n "$TEST_SCRIPT"
    if grep -En '(^|[[:space:];|&])par([[:space:]]|$)|/par([[:space:]]|$)' \
        "$HELPER" > "$TEST_ROOT/external-formatter.log"; then
        cat "$TEST_ROOT/external-formatter.log" >&2
        fail 'helper invokes an external paragraph formatter'
    fi
    if grep -En '\{[0-9]+,[0-9]*\}' "$HELPER" \
        > "$TEST_ROOT/awk-intervals.log"; then
        cat "$TEST_ROOT/awk-intervals.log" >&2
        fail 'helper uses an awk ERE interval expression'
    fi
    if grep -Fq 'map''file' "$TEST_SCRIPT"; then
        fail 'fixture uses non-portable array loading'
    fi
}

test_single_line_body_and_staging() {
    local body='Single line body stays unchanged. BODY_OUTPUT_CANARY'
    local subject='feat(fixture): preserve single-line body'
    local expected actual_files

    printf 'single\n' > 'single file.txt'
    printf 'leading\n' > '-leading.txt'
    printf 'unselected\n' > 'unselected.txt'
    bash "$HELPER" -f 'single file.txt' -f '-leading.txt' \
        -m "$subject" -b "$body" > "$TEST_ROOT/single-helper.log"

    expected="feat(fixture): preserve single-line body

Single line body stays unchanged. BODY_OUTPUT_CANARY"
    assert_eq "$expected" "$(git log -1 --format=%B)" \
        'single-line body and subject remain unchanged'
    actual_files="$(git diff-tree --root --no-commit-id --name-only -r HEAD | LC_ALL=C sort)"
    assert_eq $'-leading.txt\nsingle file.txt' "$actual_files" \
        'repeatable -f stages only named files, including a leading dash'
    if git ls-files --error-unmatch -- 'unselected.txt' >/dev/null 2>&1; then
        fail 'helper staged an unselected file'
    fi
    assert_log_excludes 'BODY_OUTPUT_CANARY' "$TEST_ROOT/single-helper.log" \
        'helper diagnostics do not print body content'
}

test_required_message() {
    local before
    before="$(git rev-parse HEAD)"
    if bash "$HELPER" -b 'Missing subject body' \
        > "$TEST_ROOT/required-message.log" 2>&1; then
        fail 'helper accepted a commit without -m'
    fi
    assert_eq "$before" "$(git rev-parse HEAD)" \
        'missing -m does not create a commit'
    assert_log_excludes 'Missing subject body' "$TEST_ROOT/required-message.log" \
        'required-message error does not print body content'
}

test_positional_operand_rejection() {
    local before
    before="$(git rev-parse HEAD)"
    printf 'positional\n' > 'positional.txt'

    if bash "$HELPER" unexpected -f 'positional.txt' \
        -m 'test(fixture): reject positional operands' \
        > "$TEST_ROOT/positional.log" 2>&1; then
        fail 'helper accepted a positional operand before its options'
    fi
    assert_eq "$before" "$(git rev-parse HEAD)" \
        'positional rejection does not create a commit'
    if git ls-files --error-unmatch -- 'positional.txt' >/dev/null 2>&1; then
        fail 'positional rejection staged its named file'
    fi
    assert_log_includes 'unexpected positional operand' "$TEST_ROOT/positional.log" \
        'positional rejection names the usage error'
    assert_log_includes 'Usage:' "$TEST_ROOT/positional.log" \
        'positional rejection prints helper usage'
}

test_pre_staged_exclusion_and_clean_selection() {
    local before before_diff_hash actual_files newline_path
    before="$(git rev-parse HEAD)"
    newline_path=$'pre-staged\nnewline.txt'

    printf 'unrelated spaces\n' > 'pre-staged unrelated.txt'
    printf 'unrelated leading dash\n' > '-pre-staged-leading.txt'
    printf 'unrelated newline\n' > "$newline_path"
    git add -- 'pre-staged unrelated.txt' '-pre-staged-leading.txt' "$newline_path"
    before_diff_hash="$(git diff --cached --binary | git hash-object --stdin)"
    printf 'clean spaces\n' > 'clean selection.txt'
    printf 'clean leading dash\n' > '-clean-leading.txt'

    if bash "$HELPER" -f 'clean selection.txt' -f '-clean-leading.txt' \
        -m 'test(fixture): reject pre-staged paths outside selection' \
        > "$TEST_ROOT/pre-staged.log" 2>&1; then
        fail 'helper accepted pre-staged paths outside explicit -f'
    fi
    assert_eq "$before" "$(git rev-parse HEAD)" \
        'pre-staged exclusion rejects before creating a commit'
    assert_eq "$before_diff_hash" \
        "$(git diff --cached --binary | git hash-object --stdin)" \
        'pre-staged exclusion preserves the exact existing index diff'
    if git ls-files --error-unmatch -- 'clean selection.txt' >/dev/null 2>&1; then
        fail 'pre-staged exclusion staged an intended file before rejecting'
    fi
    assert_log_includes 'staged path outside explicit -f selection' \
        "$TEST_ROOT/pre-staged.log" 'rejection reports the explicit-scope violation'
    assert_log_includes '-pre-staged-leading.txt' "$TEST_ROOT/pre-staged.log" \
        'rejection reports a leading-dash path'
    assert_log_includes 'pre-staged\nnewline.txt' "$TEST_ROOT/pre-staged.log" \
        'rejection shell-quotes a newline in a path'

    git reset -q
    bash "$HELPER" -f 'clean selection.txt' -f '-clean-leading.txt' \
        -m 'test(fixture): commit a clean explicit selection' \
        > "$TEST_ROOT/clean-selection.log"
    actual_files="$(git diff-tree --no-commit-id --name-only -r HEAD | LC_ALL=C sort)"
    assert_eq $'-clean-leading.txt\nclean selection.txt' "$actual_files" \
        'intended files commit after the operator clears rejected staging'
    if git ls-files --error-unmatch -- 'pre-staged unrelated.txt' >/dev/null 2>&1; then
        fail 'clean selection implicitly broadened to the rejected path'
    fi
}

test_staged_enumeration_failure_preserves_index() {
    local before before_diff_hash real_git wrapper_dir rc=0
    before="$(git rev-parse HEAD)"

    printf 'selected before enumeration\n' > 'enumeration-staged.txt'
    printf 'intended after enumeration\n' > 'enumeration-intended.txt'
    git add -- 'enumeration-staged.txt'
    before_diff_hash="$(git diff --cached --binary | git hash-object --stdin)"

    real_git="$(command -v git)"
    wrapper_dir="$TEST_ROOT/enumeration-failure-bin"
    mkdir -p -- "$wrapper_dir"
    cat > "$wrapper_dir/git" <<EOF
#!/usr/bin/env bash
if [[ \$# -eq 4 && "\$1" == diff && "\$2" == --cached &&
        "\$3" == --name-only && "\$4" == -z ]]; then
    printf 'fixture: forced staged-path enumeration failure\n' >&2
    exit 42
fi
exec "$real_git" "\$@"
EOF
    chmod +x "$wrapper_dir/git"

    if PATH="$wrapper_dir:$PATH" bash "$HELPER" \
        -f 'enumeration-staged.txt' -f 'enumeration-intended.txt' \
        -m 'test(fixture): reject staged enumeration failure' \
        > "$TEST_ROOT/staged-enumeration-failure.log" 2>&1; then
        fail 'helper accepted a staged enumeration failure'
    else
        rc="$?"
    fi
    assert_eq '1' "$rc" 'enumeration failure propagates through the validator'
    assert_eq "$before" "$(git rev-parse HEAD)" \
        'enumeration failure rejects before creating a commit'
    assert_eq "$before_diff_hash" \
        "$(git diff --cached --binary | git hash-object --stdin)" \
        'enumeration failure preserves the exact existing index diff'
    if git ls-files --error-unmatch -- 'enumeration-intended.txt' \
        >/dev/null 2>&1; then
        fail 'enumeration failure staged an intended file before rejecting'
    fi
    assert_log_includes 'forced staged-path enumeration failure' \
        "$TEST_ROOT/staged-enumeration-failure.log" \
        'enumeration failure retains the git diagnostic'
    assert_log_includes 'Commit aborted; reconcile the staged paths above before retrying.' \
        "$TEST_ROOT/staged-enumeration-failure.log" \
        'enumeration failure reports the commit abort'

    git reset -q
}

test_trailer_shaped_body_diagnostic_canary() {
    local body expected
    body='Private body paragraph BODY_SECRET_CANARY stays in the commit only.
Co-Authored-by: TRAILER_BODY_SECRET_CANARY <secret@example.invalid>'
    expected='test(fixture): hide trailer-shaped body diagnostics

Private body paragraph BODY_SECRET_CANARY stays in the commit only.
Co-Authored-by: TRAILER_BODY_SECRET_CANARY <secret@example.invalid>'
    printf 'body canary\n' > 'body-canary.txt'

    bash "$HELPER" -f 'body-canary.txt' \
        -m 'test(fixture): hide trailer-shaped body diagnostics' \
        -b "$body" > "$TEST_ROOT/body-canary.log" 2>&1
    assert_eq "$expected" "$(git log -1 --format=%B)" \
        'trailer-shaped body canary remains in the complete message'
    assert_log_excludes 'BODY_SECRET_CANARY' "$TEST_ROOT/body-canary.log" \
        'helper diagnostics omit an ordinary body canary'
    assert_log_excludes 'TRAILER_BODY_SECRET_CANARY' "$TEST_ROOT/body-canary.log" \
        'helper diagnostics omit a trailer-shaped body canary'
}

test_staged_only_human_commit() {
    local subject
    subject='test(fixture): preserve staged-only human commit semantics'
    printf 'staged only\n' > 'staged-only.txt'
    git add -- 'staged-only.txt'

    bash "$HELPER" -m "$subject" > "$TEST_ROOT/staged-only.log" 2>&1
    assert_eq "$subject" "$(git log -1 --format=%B)" \
        'omitting -f and -c commits only the existing staged human change'
    assert_eq 'staged-only.txt' \
        "$(git diff-tree --no-commit-id --name-only -r HEAD)" \
        'staged-only human commit retains its selected path'
}

test_prose_reflow() {
    local body expected
    body='Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu
xi omicron pi rho sigma tau upsilon phi chi psi omega.

Already wrapped
prose joins into one line.'
    expected='test(fixture): reflow prose deterministically

Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi
omicron pi rho sigma tau upsilon phi chi psi omega.

Already wrapped prose joins into one line.'

    printf 'prose\n' > 'prose.txt'
    bash "$HELPER" -f 'prose.txt' \
        -m 'test(fixture): reflow prose deterministically' \
        -b "$body" > "$TEST_ROOT/prose-helper.log"

    assert_eq "$expected" "$(git log -1 --format=%B)" \
        'prose reflow matches the explicit 72-column result'
    if ! git log -1 --format=%b | awk 'length($0) > 72 { exit 1 }'; then
        fail 'a prose line exceeds 72 columns'
    fi
    if ! git log -1 --format=%b | awk 'NR == 1 { exit(length($0) == 72 ? 0 : 1) }'; then
        fail 'greedy reflow does not use the 72-column boundary'
    fi
}

test_legacy_awk_fence_preservation() {
    local body expected
    body='Ordinary prose before the fences remains short.

```
zero-indent fence keeps   repeated spaces and this long line remains unchanged beyond seventy-two columns
```

 ```
one-space fence keeps   repeated spaces and this long line remains unchanged beyond seventy-two columns
   ```

  ~~~~
two-space tilde fence keeps   repeated spaces and this long line remains unchanged beyond seventy-two columns
  ~~~~

   ````
three-space four-backtick fence keeps   repeated spaces and this long line remains unchanged beyond seventy-two columns
```
   ````

Ordinary prose after the fences also remains short.'
    expected="test(fixture): preserve fences with legacy awk constructs

$body"
    printf 'legacy fences\n' > 'legacy-fences.txt'

    bash "$HELPER" -f 'legacy-fences.txt' \
        -m 'test(fixture): preserve fences with legacy awk constructs' \
        -b "$body" > "$TEST_ROOT/legacy-fences.log"
    assert_eq "$expected" "$(git log -1 --format=%B)" \
        'zero-to-three-space backtick and tilde fences retain every byte'
}

test_structure_trailers_and_identity() {
    local long_word long_url body open_code prospero expected
    local rc trailer_count=0 trailer_line
    local -a trailer_lines
    long_word='pneumonoultramicroscopicsilicovolcanoconiosispneumonoultramicroscopicsilicovolcanoconiosis'
    long_url='https://example.invalid/a/very/long/path/that/must/remain/unchanged/even/though/it/exceeds/seventy/two/columns'
    open_code='OpenCode  (moonshotai/Kimi-K3.1-Pro) <opencode-agent>'
    prospero='Prospero (moonshotai/Kimi-K3.1-Pro) <https://github.com/skeeto/prospero>'
    body='- first list item with enough words to exceed seventy-two columns without being wrapped into another item
- second list item stays separate
1. first ordered item stays separate
2. second ordered item stays separate

    indented code keeps four leading spaces and this long line remains unchanged beyond seventy-two columns

```sh
fenced code keeps   repeated spaces and this long line remains unchanged beyond seventy-two columns
fenced second line stays separate
```

This oversized word stays intact:

'"$long_word"'

This oversized URL stays intact:

'"$long_url"'

Reviewed-by: Fixture Human <fixture.human@example.invalid>'

    printf 'structure\n' > 'structure.txt'
    GIT_COMMITTER_NAME='Fixture Human' \
        GIT_COMMITTER_EMAIL='fixture.human@example.invalid' \
        bash "$HELPER" -f 'structure.txt' \
        -m 'test(fixture): protect structure and attribution' \
        -b "$body" -c "$open_code" -c "$prospero" \
        > "$TEST_ROOT/structure-helper.log"

    expected="test(fixture): protect structure and attribution

$body

Co-Authored-by: $open_code

Co-Authored-by: $prospero"
    assert_eq "$expected" "$(git log -1 --format=%B)" \
        'structural lines, blank lines, and ordered trailers match exactly'
    assert_eq 'Fixture Human' "$(git log -1 --format=%an)" \
        'Author name remains the fixture human'
    assert_eq 'fixture.human@example.invalid' "$(git log -1 --format=%ae)" \
        'Author email remains the fixture human email'
    assert_eq 'Fixture Human' "$(git log -1 --format=%cn)" \
        'Committer name matches the same fixture human as Author'
    assert_eq 'fixture.human@example.invalid' "$(git log -1 --format=%ce)" \
        'Committer email matches the same fixture human as Author'

    printf '%s\n' "$expected" > "$TEST_ROOT/structure-expected.message"
    git cat-file commit HEAD | awk 'message { print } !message && /^$/ { message=1 }' \
        > "$TEST_ROOT/structure-actual.message"
    assert_eq \
        "$(git hash-object "$TEST_ROOT/structure-expected.message")" \
        "$(git hash-object "$TEST_ROOT/structure-actual.message")" \
        'complete message bytes, trailer lengths, and blank paragraphs match exactly'

    while IFS= read -r trailer_line; do
        trailer_lines[trailer_count]="$trailer_line"
        trailer_count=$((trailer_count + 1))
    done < <(git log -1 --format=%B | awk '/^Co-Authored-by:/')
    assert_eq '2' "$trailer_count" 'two -c values produce two complete trailer lines'
    assert_eq "Co-Authored-by: $open_code" "${trailer_lines[0]}" \
        'OpenCode trailer retains two spaces and stays on one line'
    assert_eq "Co-Authored-by: $prospero" "${trailer_lines[1]}" \
        'Prospero trailer follows OpenCode and stays on one line'

    if git log --format=%B -1 | grep -F '\n' > "$TEST_ROOT/literal-newline.log"; then
        fail 'commit message contains a literal backslash-n'
    else
        rc="$?"
        assert_eq '1' "$rc" 'literal backslash-n grep completes normally'
    fi
    assert_eq '' "$(cat "$TEST_ROOT/literal-newline.log")" \
        'literal backslash-n inspection prints no matches'
}

run_test 'shell syntax and portable formatter construction' \
    test_syntax_and_no_external_formatter
run_test 'single-line body and exact file staging' test_single_line_body_and_staging
run_test 'required commit message' test_required_message
run_test 'positional operand rejection' test_positional_operand_rejection
run_test 'pre-staged exclusion and clean explicit selection' \
    test_pre_staged_exclusion_and_clean_selection
run_test 'staged enumeration failure preserves HEAD and index' \
    test_staged_enumeration_failure_preserves_index
run_test 'trailer-shaped body diagnostic canary' \
    test_trailer_shaped_body_diagnostic_canary
run_test 'staged-only human commit without -f or -c' test_staged_only_human_commit
run_test 'deterministic prose-only reflow' test_prose_reflow
run_test 'legacy awk fence preservation' test_legacy_awk_fence_preservation
run_test 'structure, exact trailer bytes, and same-human identity' \
    test_structure_trailers_and_identity

printf '1..%d\n' "$PASS_COUNT"
printf 'All %d fixture test groups passed.\n' "$PASS_COUNT"
