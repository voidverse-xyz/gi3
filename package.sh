#!/bin/bash
# Package the production extension into an installable ZIP.
# Development-only files under dev/ are never included.
set -euo pipefail

if (( $# != 0 )); then
    echo "usage: $0" >&2
    exit 1
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"
NAME="gi3"
OUT="${ROOT}/${NAME}.zip"

STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT

cp -r "${ROOT}/src/." "${STAGE}/"
cp "${ROOT}/LICENSE" "${STAGE}/LICENSE"
cp "${ROOT}/THIRD_PARTY_NOTICES.md" "${STAGE}/THIRD_PARTY_NOTICES.md"
cp -r "${ROOT}/licenses" "${STAGE}/licenses"
rm -f "${STAGE}/schemas/gschemas.compiled"

echo "Building gi3 production package..."

rm -f "${OUT}"
python3 - "${STAGE}" "${OUT}" <<'PY'
import sys
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

stage = Path(sys.argv[1])
output = Path(sys.argv[2])

with ZipFile(output, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted(stage.rglob("*")):
        if path.is_file():
            archive.write(path, path.relative_to(stage))
PY

echo "Wrote ${OUT}"
