#!/usr/bin/env bash
# Seeds the eval workspace with a scratch clone of the repository at the tip of
# PR #28 (e177e7d). The harness runs this with the empty workspace as its working
# directory and only under --scaffold. The eval job's own clone is shallow and
# holds neither 251cebe nor e177e7d, so both are fetched by sha from the origin
# the checkout came from; the PR's base is needed for `git diff 251cebe e177e7d`.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
url="$(git -C "$root" remote get-url origin 2>/dev/null || true)"
if [ -z "$url" ]; then
  echo "review-recall-pr28 scaffold: the plugin checkout has no origin remote, so 251cebe and e177e7d cannot be fetched" >&2
  exit 1
fi
git init -q .
git remote add origin "$url"
git fetch -q --no-tags origin 251cebe e177e7d
git checkout -q --detach e177e7d
