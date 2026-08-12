#!/usr/bin/env bash
# Copy the web app into the iOS bundle.
#
# The Swift shell serves HomeHub/Web/ verbatim over its custom scheme, so
# this is the only build step: run it after changing anything in css/ or
# js/, then build in Xcode. Deliberately a copy rather than a symlink —
# Xcode does not follow symlinks into app bundles reliably.
set -euo pipefail
cd "$(dirname "$0")"

SRC=..
DEST=HomeHub/Web

rm -rf "$DEST"
mkdir -p "$DEST"

for item in index.html manifest.webmanifest css js assets; do
  cp -R "$SRC/$item" "$DEST/"
done

# sw.js is intentionally omitted: the bundle is already local, and a
# service worker over a custom scheme buys nothing but staleness.

echo "Copied $(find "$DEST" -type f | wc -l | tr -d ' ') files into $DEST"
