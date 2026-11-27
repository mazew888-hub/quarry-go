#!/bin/sh
# Stress clips: every frame shows its own index as 10 black/white bands (bit k = band k), so any frame
# read back (decoded, retimed, exported) says exactly which source frame it is.
set -e
D="$(dirname "$0")/../fixtures/stress"; mkdir -p "$D"
G="geq=lum='255*mod(floor(N/pow(2\,floor(X*10/W)))\,2)':cb=128:cr=128"
mk() { # rate seconds name codec-args...
  r=$1; s=$2; n=$3; shift 3
  [ -f "$D/$n" ] || ffmpeg -v error -y -f lavfi -i "color=c=black:s=320x180:r=$r:d=$s" -vf "$G" "$@" "$D/$n"
}
for r in 23.976 24 25 29.97 30 50 60; do mk $r 3 "h264_$r.mp4" -c:v libx264 -pix_fmt yuv420p -crf 12 -g 12 -bf 2; done
mk 30 3 h264_30.mov -c:v libx264 -pix_fmt yuv420p -crf 12
mk 30 3 mpeg4_30.mov -c:v mpeg4 -q:v 2 -tag:v mp4v
mk 24 3 prores_24.mov -c:v prores_ks -profile:v 0
mk 25 3 mjpeg_25.mov -c:v mjpeg -q:v 2
mk 30 3 hevc_30.mp4 -c:v libx265 -pix_fmt yuv420p -tag:v hvc1 -x265-params log-level=error
mk 30 8 h264_30_long.mp4 -c:v libx264 -pix_fmt yuv420p -crf 14
# a variable-rate clip like an iPhone screen recording: mostly 30 fps with uneven gaps
[ -f "$D/vfr.mp4" ] || ffmpeg -v error -y -f lavfi -i "color=c=black:s=320x180:r=30:d=3" -vf "$G,setpts='N/30/TB+if(mod(N,7),0,0.012/TB)'" -fps_mode vfr -c:v libx264 -pix_fmt yuv420p -crf 12 "$D/vfr.mp4"
ls "$D"
