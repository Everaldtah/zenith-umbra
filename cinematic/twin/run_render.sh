#!/usr/bin/env bash
# One LoadGuard hold for the whole render: screen the clips' own sound (Whisper), then cut the film + web encode.
set -e
cd "$(dirname "$0")"
python clip_audio.py
python make_film.py
