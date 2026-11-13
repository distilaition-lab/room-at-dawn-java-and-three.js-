#!/bin/bash
# c.sh name "<carShot args>|||<carShot args>..."  -> contact sheet name.jpg (2 columns)
S=/tmp/claude-0/-home-user-room-at-dawn-java-and-three-js-/f67862fe-0021-5c2d-97d3-58c94fed3a98/scratchpad/s
IFS='~' read -ra A <<< "$2"; E=""; for a in "${A[@]}"; do E="$E|||api.${3:-carShot}({$a})"; done; E=${E:3}
rm -f $S/$1_*.jpg; node canyon/tools/shot.mjs $S/$1.jpg "$E" 2>&1 | grep -iE "error|warn|THREE" | head -20
n=$(ls $S/$1_*.jpg 2>/dev/null | wc -l); if [ "$n" -gt 1 ]; then ffmpeg -y -v error -pattern_type glob -i "$S/$1_*.jpg" -vf "tile=2x$(( (n+1)/2 ))" -q:v 3 $S/$1.jpg; else cp $S/$1_0.jpg $S/$1.jpg 2>/dev/null || true; fi
