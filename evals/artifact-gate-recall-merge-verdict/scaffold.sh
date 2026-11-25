#!/usr/bin/env bash
# Seeds the eval workspace with a scratch clone of the repository at
# 496635588f0d11ae9505970b12313d2542f4a1a9, where the change add-merge-confidence-gate is an active
# change. The harness runs this with the empty workspace as its working directory
# and only under --scaffold. The eval job's own clone is shallow and does not hold
# that commit, so it is fetched by sha from the origin the checkout came from.
# Fetch and check out by the full 40-hex sha: `git fetch` reads an abbreviated
# sha as a ref name, finds no such remote ref and exits 128, which `set -e` turns
# into a scaffold that never seeds the workspace (test/evals.test.mjs pins it).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
url="$(git -C "$root" remote get-url origin 2>/dev/null || true)"
if [ -z "$url" ]; then
  echo "artifact-gate-recall-merge-verdict scaffold: the plugin checkout has no origin remote, so 496635588f0d11ae9505970b12313d2542f4a1a9 cannot be fetched" >&2
  exit 1
fi
git init -q .
git remote add origin "$url"
git fetch -q --no-tags origin 496635588f0d11ae9505970b12313d2542f4a1a9
git checkout -q --detach 496635588f0d11ae9505970b12313d2542f4a1a9
