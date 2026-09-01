#!/usr/bin/env bash
#
# Uploads the built site and invalidates the edge cache. Run by .github/workflows/
# deploy.yml on a v* tag, and safe to run by hand with credentials.
#
#   scripts/deploy.sh [--dry-run]
#
# Bash rather than TypeScript because this is five AWS CLI calls on a fixed platform:
# there is no JSON to parse (--query --output text returns plain strings), nothing to
# prompt for, and the runner has the CLI preinstalled. Keeping it here means the release
# job does not need a TypeScript runner to copy files to S3.
#
# Two passes matter. Fingerprinted assets are immutable and cached for a year; the HTML
# entry points must never be cached, or a tagged release stays invisible behind
# CloudFront's CACHING_OPTIMIZED policy. The invalidation below only clears CloudFront —
# a Cache-Control header already in a visitor's browser cannot be recalled, which is why
# the headers are set here at upload time rather than left to the distribution.
#
# --dry-run lists every object it would upload or delete and skips the invalidation. It
# still reads the real stack and the real bucket, so it exercises credentials and the
# stack lookup rather than mocking them.
set -euo pipefail

BUILD_DIR="build/client"

# The CloudFormation stack name, which infra/bin/Launcher.ts sets to the project slug.
# The slug is pinned to the repository name by scripts/setup.ts, and both CI and a local
# clone check out into a directory of that name — so the checkout is the stack name. Set
# STACK explicitly to override.
STACK="${STACK:-$(basename "$(git rev-parse --show-toplevel)")}"

dry_run=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    *) echo "Unknown argument: $arg" >&2; exit 1 ;;
  esac
done

# `aws s3 sync --dryrun` lists every copy and delete it would perform without executing
# any of them, so the dry run is the real diff against the bucket.
sync_flags=()
label=""
if [ "$dry_run" = true ]; then
  sync_flags=(--dryrun)
  label="[dry run] "
fi

# Empty-array expansion under `set -u` errors on bash 3.2, which is what macOS ships.
expand_flags() { printf '%s\n' ${sync_flags[@]+"${sync_flags[@]}"}; }

if [ ! -d "$BUILD_DIR" ]; then
  echo "$BUILD_DIR not found. Run \"npm run build\" first." >&2
  exit 1
fi

stack_output() {
  aws cloudformation describe-stacks \
    --stack-name "$STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" \
    --output text 2>/dev/null || true
}

require_output() {
  local value
  value="$(stack_output "$1")"
  if [ -z "$value" ] || [ "$value" = "None" ]; then
    echo "Stack \"$STACK\" has no output named $1. Is it deployed, and is the name right?" >&2
    exit 1
  fi
  printf '%s' "$value"
}

BUCKET="$(require_output BucketName)"
DISTRIBUTION="$(require_output DistributionId)"

echo "${label}Uploading $BUILD_DIR to s3://$BUCKET"

# Pass 1: everything except HTML and route data, cached forever. React Router
# fingerprints these filenames, so a changed file is a new key and never needs
# invalidating.
# shellcheck disable=SC2046
aws s3 sync "$BUILD_DIR" "s3://$BUCKET" \
  --delete \
  --exclude '*.html' \
  --exclude '*.data' \
  --cache-control 'public, max-age=31536000, immutable' \
  $(expand_flags)

# Pass 2: HTML and route data, revalidated on every request.
# shellcheck disable=SC2046
aws s3 sync "$BUILD_DIR" "s3://$BUCKET" \
  --delete \
  --exclude '*' \
  --include '*.html' \
  --include '*.data' \
  --cache-control 'no-cache, must-revalidate' \
  $(expand_flags)

if [ "$dry_run" = true ]; then
  echo "${label}Would invalidate distribution $DISTRIBUTION at /*"
  echo "${label}Nothing was uploaded, deleted or invalidated."
else
  echo "Invalidating distribution $DISTRIBUTION"
  aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION" --paths '/*' >/dev/null
fi

# The stack knows the real URL: the custom domain, or the distribution's own name.
echo "${label}Done. $(stack_output SiteUrl)"
