#!/usr/bin/env bash
# Build and sign the assets for a CoPanel GitHub release.
#
#   scripts/release/make_release.sh 1.2.3 /path/to/copanel-release-ed25519 [out_dir]
#
# Run on the commit that will be tagged v1.2.3 (VERSION must say 1.2.3).
# Creates the tag locally if it does not exist yet, then writes to out_dir
# (default: release-artifacts/v1.2.3):
#   CoPanel-1.2.3.zip            git archive of the tag
#   copanel-release.json         manifest: repo, tag, version, commit, zip sha256
#   copanel-release.json.sig     ssh-keygen -Y sign (namespace copanel-release)
#   SHA256SUMS                   sha256 of the zip and the manifest
# Upload all four to the release (see docs/RELEASING.md). Panel Update and the
# install one-liner refuse a release whose manifest signature does not verify
# against scripts/release/allowed_signers.
set -euo pipefail

version="${1:?usage: make_release.sh <version> <private-key> [out_dir]}"
key="${2:?usage: make_release.sh <version> <private-key> [out_dir]}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "version must be X.Y.Z" >&2; exit 1; }
tag="v${version}"
root="$(git rev-parse --show-toplevel)"
cd "$root"
out="${3:-$root/release-artifacts/$tag}"

[[ "$(tr -d '[:space:]' < VERSION)" == "$version" ]] || { echo "VERSION file is not $version" >&2; exit 1; }
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || { echo "working tree has changes" >&2; exit 1; }

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    commit="$(git rev-parse "refs/tags/$tag^{commit}")"
else
    commit="$(git rev-parse HEAD)"
    git tag -a "$tag" -m "CoPanel $version" "$commit"
fi

mkdir -p "$out"
zip="CoPanel-${version}.zip"
git archive --format=zip --prefix="CoPanel-${version}/" -o "$out/$zip" "$commit"
zip_sha="$(sha256sum "$out/$zip" | cut -d' ' -f1)"

cat > "$out/copanel-release.json" <<JSON
{
  "repo": "phuspeed/CoPanel",
  "tag": "$tag",
  "version": "$version",
  "commit": "$commit",
  "zip": "$zip",
  "zip_sha256": "$zip_sha"
}
JSON

rm -f "$out/copanel-release.json.sig"
ssh-keygen -q -Y sign -f "$key" -n copanel-release "$out/copanel-release.json"
ssh-keygen -Y verify -f scripts/release/allowed_signers -I copanel-release -n copanel-release \
    -s "$out/copanel-release.json.sig" < "$out/copanel-release.json"

( cd "$out" && sha256sum "$zip" copanel-release.json copanel-release.json.sig > SHA256SUMS )
echo "Release assets for $tag ($commit) in $out:"
ls -l "$out"
