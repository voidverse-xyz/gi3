#! /bin/bash
# Install the RELEASE build locally (dev-only code stays out; see package.sh).
set -e

echo "Installing gi3..."

DIR="$(cd "$(dirname "$0")" && pwd)"

"${DIR}/package.sh"
gnome-extensions install --force "${DIR}/gi3.zip"

echo "Installed. Log out and back in (Wayland) to load the new version, then enable with:"
echo "  gnome-extensions enable gi3@voidverse.xyz"
