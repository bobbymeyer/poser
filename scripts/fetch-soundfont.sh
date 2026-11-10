#!/bin/sh
# Downloads GeneralUser GS (a free General MIDI soundfont) for local development.
# The file is gitignored; the spike also accepts any .sf2/.sf3 dropped onto the page.
set -e
mkdir -p public/soundfonts
curl -fL --retry 3 -o public/soundfonts/default.sf3 \
  https://raw.githubusercontent.com/spessasus/SpessaSynth/master/soundfonts/GeneralUserGS.sf3
echo "Saved public/soundfonts/default.sf3"
