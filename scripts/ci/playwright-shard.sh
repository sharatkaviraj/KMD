#!/usr/bin/env bash
# Run several synthetic Playwright configs, one after another, in one CI job.
#
#   scripts/ci/playwright-shard.sh <config.playwright.config.ts>...
#
# Why a shard instead of one job per config: each job used to spend ~75s on
# container start + checkout + `npm ci` around 15–130s of tests (measured
# median over 20 runs, 5 Nov 2026). Running a balanced group per job keeps
# every config, spec and project — nothing is skipped or filtered.
#
# Every config runs even when an earlier one fails; the script exits non-zero
# if any failed. Several configs share an outputDir (`test-results`, or the
# default `tests/playwright/test-results`) and Playwright empties its outputDir
# when a run starts, so a failed config's output is copied to
# `.shard-failures/<config>/` before the next config can wipe it.
#
# Per-config preparation (static builds and their env) lives in prepare().
# Synthetic only: no database credentials are available or needed.
set -uo pipefail

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <config.playwright.config.ts>..." >&2
  exit 2
fi

summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then echo "$1" >> "$GITHUB_STEP_SUMMARY"; fi
}

prepare() {
  case "$1" in
    class-followup.playwright.config.ts)
      npx vite build --config tests/class-followup/vite.config.ts || return 1
      export PHONEOPS_CLASS_STATIC_DIR="../evidence/class-followup-static"
      ;;
    student360-sibling.playwright.config.ts)
      npx vite build --config tests/sibling-context/vite.config.ts || return 1
      export PHONEOPS_SIBLING_STATIC_DIR="../evidence/sibling-context-static"
      ;;
  esac
  return 0
}

keep_failure() {
  local dest=".shard-failures/${1%.playwright.config.ts}"
  mkdir -p "$dest"
  for dir in test-results tests/playwright/test-results .playwright .test-artifacts; do
    if [ -d "$dir" ]; then
      mkdir -p "$dest/$(echo "$dir" | tr '/.' '__')"
      cp -R "$dir/." "$dest/$(echo "$dir" | tr '/.' '__')/" 2>/dev/null || true
    fi
  done
  # ../evidence holds several configs' output plus built static fixtures. Keep
  # the same filter as the workflow's "safe evidence" step (no *admin* /
  # *server* files) and skip the *-static builds, which are inputs, not results.
  if [ -d ../evidence ]; then
    mkdir -p "$dest/evidence"
    find ../evidence -mindepth 1 -maxdepth 1 ! -name '*-static' ! -name '*admin*' ! -name '*server*' \
      -exec cp -R {} "$dest/evidence/" \; 2>/dev/null || true
  fi
}

# Per-config limit, so a hung config ends as an ordinary failure (its output
# is kept and uploaded) instead of running into the job timeout, which GitHub
# reports as "cancelled". The slowest config measured ~3 min including its
# fixture build (5 Nov 2026), so 6 min is twice that.
CONFIG_TIMEOUT="${PLAYWRIGHT_SHARD_CONFIG_TIMEOUT:-360}"

failed=()
summary "| Config | Result | Seconds |"
summary "|---|---|---|"
for config in "$@"; do
  echo "::group::${config}"
  start=$(date +%s)
  (
    prepare "$config" || exit 1
    timeout --kill-after=30 "$CONFIG_TIMEOUT" npx playwright test --config "tests/playwright/${config}"
  )
  status=$?
  seconds=$(( $(date +%s) - start ))
  echo "::endgroup::"
  why="exit ${status}"
  if [ "$status" -eq 124 ] || [ "$status" -eq 137 ]; then why="timed out after ${CONFIG_TIMEOUT}s"; fi
  if [ "$status" -eq 0 ]; then
    echo "${config}: passed in ${seconds}s"
    summary "| \`${config}\` | passed | ${seconds} |"
  else
    echo "::error title=${config} failed::${why} (${seconds}s)"
    summary "| \`${config}\` | **failed** (${why}) | ${seconds} |"
    keep_failure "$config"
    failed+=("$config")
  fi
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "Failed configs: ${failed[*]}" >&2
  exit 1
fi
