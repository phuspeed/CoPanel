# Releasing CoPanel

Panel Update (web) and the install one-liner install the **latest GitHub
release**, not the tip of `main`. A release is accepted only when its manifest
`copanel-release.json` carries a valid signature from the CoPanel release key.

The public key is committed as `scripts/release/allowed_signers` and also
embedded in `scripts/install.sh` (`COPANEL_RELEASE_PUBKEY`); a test checks the two match.
The private key is never committed. Keep it offline, with a backup.

## Steps

1. Merge the release PR. It must bump `VERSION` and update `CHANGELOG.md`, `CHANGELOG.vi.md`
   and the README badges. If the frontend changed, it must also rebuild `frontend/prebuilt/dist.tar.gz`.
2. On a clean checkout of `main` at the merge commit:

   ```bash
   git pull --ff-only
   scripts/release/make_release.sh 1.2.3 ~/keys/copanel-release-ed25519
   git push origin v1.2.3
   gh release create v1.2.3 --latest --title "CoPanel 1.2.3" --notes-file notes.md \
     release-artifacts/v1.2.3/CoPanel-1.2.3.zip \
     release-artifacts/v1.2.3/copanel-release.json \
     release-artifacts/v1.2.3/copanel-release.json.sig \
     release-artifacts/v1.2.3/SHA256SUMS
   ```

3. Check the release: run `sha256sum -c SHA256SUMS` on the downloaded assets, then

   ```bash
   ssh-keygen -Y verify -f scripts/release/allowed_signers -I copanel-release \
     -n copanel-release -s copanel-release.json.sig < copanel-release.json
   ```

Publish the release **before** telling users to update. A panel on 1.1.14 or older
runs the `install.sh` from `main`. That script installs the latest signed release.

## How installs verify

- **Panel Update (1.1.15+)**
  1. Reads `releases/latest`.
  2. Downloads the manifest and its signature.
  3. Verifies them against the installed `scripts/release/allowed_signers`.
  4. Fetches the tag and checks that it resolves to the signed commit.
  5. Runs that commit's `install.sh` with `COPANEL_GIT_REF` and `COPANEL_EXPECT_COMMIT` set.

  Any failure stops the update before anything changes, and the panel keeps running.
- **One-liner** (`curl -fsSL https://copanel.io.vn/install.sh | sudo bash`)
  1. Resolves the latest release and verifies its manifest with the embedded key.
  2. Refuses to install if the signature is invalid.
  3. Checks out the signed commit.

  If GitHub's API cannot be reached, it falls back to `main` with a warning.
  It does the same when the release has no manifest, or when `ssh-keygen` is missing.
- `COPANEL_GIT_BRANCH=<branch-or-tag>` installs exactly that ref, for testing. So does `COPANEL_GIT_REMOTE`.

## Rotating the key

Add the new key to `scripts/release/allowed_signers`, keeping the old key on its own line.
Update `COPANEL_RELEASE_PUBKEY` in `install.sh`, then release with the old key once.
After that release, sign with the new key and remove the old one.
