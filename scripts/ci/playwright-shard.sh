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
  for dir in test-results tests/playwright/test-results .playwright .test-artifacts ../evidence; do
    if [ -d "$dir" ]; then
      mkdir -p "$dest/$(echo "$dir" | tr '/.' '__')"
      cp -R "$dir/." "$dest/$(echo "$dir" | tr '/.' '__')/" 2>/dev/null || true
    fi
  done
}

failed=()
summary "| Config | Result | Seconds |"
summary "|---|---|---|"
for config in "$@"; do
  echo "::group::${config}"
  start=$(date +%s)
  (
    prepare "$config" || exit 1
    npx playwright test --config "tests/playwright/${config}"
  )
  status=$?
  seconds=$(( $(date +%s) - start ))
  echo "::endgroup::"
  if [ "$status" -eq 0 ]; then
    echo "${config}: passed in ${seconds}s"
    summary "| \`${config}\` | passed | ${seconds} |"
  else
    echo "::error title=${config} failed::exit ${status} after ${seconds}s"
    summary "| \`${config}\` | **failed** (exit ${status}) | ${seconds} |"
    keep_failure "$config"
    failed+=("$config")
  fi
done

if [ "${#failed[@]}" -gt 0 ]; then
  echo "Failed configs: ${failed[*]}" >&2
  exit 1
fi
