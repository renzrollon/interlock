#!/usr/bin/env bash
# Seeds the eval workspace with this case's frozen change folder. The harness
# runs this script with the empty workspace as its working directory and only
# under --scaffold, so the fixture is found by the script's own location.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp -R "$here/fixture/." .
