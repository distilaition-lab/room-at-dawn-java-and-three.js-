#!/bin/bash
# quick look: v.sh name s d height lookAhead [fov] [side offset of target] [R]
S=/tmp/claude-0/-home-user-room-at-dawn-java-and-three-js-/f67862fe-0021-5c2d-97d3-58c94fed3a98/scratchpad/s
node canyon/tools/shot.mjs $S/$1.jpg "(()=>{const f=api.frame($2,$3),g=api.frame($2+($5),${7:-0});return api.still({pos:[f.x,f.y+($4),f.z],target:[g.x,g.y+0.8,g.z],fov:${6:-40},R:${8:-70}})})()" 2>&1 | grep -v "^\[canyon\] $" | tail -4
