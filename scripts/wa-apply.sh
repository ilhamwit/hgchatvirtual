#!/usr/bin/env bash
# Install the WhatsApp number scanned on the Koneksikan WA page (see scripts/wa-apply.js).
set -euo pipefail
exec node "$(dirname "$0")/wa-apply.js" "$@"
