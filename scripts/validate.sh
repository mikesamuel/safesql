#!/bin/bash

set -e

NODE_MAJOR_VERSION="$(node -v | perl -ne 'print $1 if m/^v?(\d+)[.]/')"
[ -n "$NODE_MAJOR_VERSION" ]

if [[ "$NODE_MAJOR_VERSION" -gt 7 ]]; then
    # Standard fails on node 7 when run on travis-ci due to some odd
    # interaction between standard and an eslint plugin.  We really
    # only need to run the linter on one platform.
    npm run-script lint
else
    echo Skipping linter on node v"$NODE_MAJOR_VERSION"
fi
npm test
