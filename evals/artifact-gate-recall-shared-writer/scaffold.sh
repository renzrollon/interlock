#!/usr/bin/env bash
# Seeds the eval workspace with a scratch clone of the repository at
# 234906b4861c7ef58a07fbdcc164085568bcaf1d, where the change bound-the-reviewers-by-agent-type does not
# exist yet, restores that change's directory from 21f7a1b72fa6debc590dc37eb780fb1a98358411, and
# applies seed.patch from this case's own directory, which adds one hazard to its
# design.md. The harness runs this with the empty workspace as its working
# directory and only under --scaffold. The eval job's own clone is shallow and
# holds neither commit, so each is fetched by sha from the origin the checkout
# came from. Fetch by the full 40-hex sha: `git fetch` reads an abbreviated sha as
# a ref name and exits 128, which `set -e` turns into a scaffold that never seeds
# the workspace (test/evals.test.mjs pins it).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
url="$(git -C "$root" remote get-url origin 2>/dev/null || true)"
if [ -z "$url" ]; then
  echo "artifact-gate-recall-shared-writer scaffold: the plugin checkout has no origin remote, so 234906b4861c7ef58a07fbdcc164085568bcaf1d and 21f7a1b72fa6debc590dc37eb780fb1a98358411 cannot be fetched" >&2
  exit 1
fi
git init -q .
git remote add origin "$url"
git fetch -q --no-tags origin 234906b4861c7ef58a07fbdcc164085568bcaf1d 21f7a1b72fa6debc590dc37eb780fb1a98358411
git checkout -q --detach 234906b4861c7ef58a07fbdcc164085568bcaf1d
git checkout -q 21f7a1b72fa6debc590dc37eb780fb1a98358411 -- openspec/changes/bound-the-reviewers-by-agent-type
if ! git apply --check "$here/seed.patch" >&2; then
  echo "artifact-gate-recall-shared-writer scaffold: seed.patch does not apply to the restored change" >&2
  exit 1
fi
git apply "$here/seed.patch" >&2
