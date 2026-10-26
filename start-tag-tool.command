#!/bin/bash
# Double click this file in Finder to start the Tag Tool on a Mac. The first time,
# it sets itself up. Everything is found relative to this file, so the folder can
# sit anywhere, as long as build/chip-cli and build/edge stay beside it.
#
# The first time, macOS may refuse to open a file downloaded from the internet.
# Right click it, choose Open, then Open again. It remembers after that.

# A double clicked script does not always get the shell's usual PATH.
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"

stop() {
  echo
  echo "======================================================================"
  echo " The Tag Tool stopped. The message above says why."
  echo " If it is not clear what to do, copy the text in this window and send"
  echo " it to Serene Labs."
  echo "======================================================================"
  echo
  read -r -p "Press Return to close this window. " _
  exit 1
}

here="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "$here/build/chip-cli/package.json" ]; then
  echo "The Tag Tool files were not found next to this file."
  echo "Expected a folder called build/chip-cli in: $here"
  echo "Keep start-tag-tool.command in the same folder as the build folder, exactly as it came."
  stop
fi
cd "$here/build/chip-cli" || stop

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed, or this window cannot find it."
  echo
  echo "  1. Go to nodejs.org and download the LTS macOS Installer (.pkg)."
  echo "  2. Run it and accept the defaults."
  echo "  3. Double click start-tag-tool.command again."
  stop
fi
if ! node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>20||(a===20&&b>=11)?0:1)"; then
  echo "This Mac has Node.js $(node --version), and the Tag Tool needs version 20.11 or newer."
  echo "Go to nodejs.org, install the LTS version, then double click this file again."
  stop
fi

# Install on the first run, and again whenever the package list has changed since.
if [ ! -d node_modules ] || ! node -e "const f=require('fs');process.exit(f.statSync('package-lock.json').mtimeMs>f.statSync('node_modules/.package-lock.json').mtimeMs?1:0)" 2>/dev/null; then
  echo
  echo "Setting up the Tag Tool. This needs the internet and takes a minute or two."
  echo
  npm ci || stop
fi

# Built every time. It takes a few seconds and means an updated copy never runs old code.
echo "Preparing the Tag Tool..."
npm run build --silent || stop

node bin/tag-tool.mjs "$@" || stop
