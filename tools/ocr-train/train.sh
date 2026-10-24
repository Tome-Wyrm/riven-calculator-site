#!/usr/bin/env bash
# Fine-tunes Tesseract's English model on the riven text lines from lines.py. Runs in WSL Ubuntu
# (tesseract-ocr, libtesseract-dev, tesstrain in /opt/ocr). From Windows:
#
#   wsl -d Ubuntu -u root -- bash /mnt/c/.../tools/ocr-train/train.sh [iterations]
#
# Output: tools/ocr-train/out/riven.traineddata (integer model, the size tesseract.js loads).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ITER="${1:-10000}"
T=/opt/ocr/tesstrain
GT="$T/data/riven-ground-truth"

rm -rf "$T/data/riven" "$GT"
mkdir -p "$GT"
cp -r "$HERE"/out/gt/. "$GT"/
cd "$T"
make training MODEL_NAME=riven START_MODEL=eng TESSDATA=/opt/ocr/tessdata \
  MAX_ITERATIONS="$ITER" LEARNING_RATE=0.0001 PSM=13 RATIO_TRAIN=0.95 -j"$(nproc)"
# A smaller, faster integer model for the browser.
combine_tessdata -e data/riven.traineddata data/riven.lstm
lstmtraining --stop_training --convert_to_int --continue_from data/riven.lstm \
  --traineddata data/riven.traineddata --model_output "$HERE/out/riven.traineddata" 2>/dev/null \
  || cp data/riven.traineddata "$HERE/out/riven.traineddata"
ls -la "$HERE/out/riven.traineddata"
