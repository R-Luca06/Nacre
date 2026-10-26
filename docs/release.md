# Releases

Push a tag (`git tag v0.2.0 && git push --tags`). The Release workflow builds signed installers for Apple Silicon, Intel and Linux, and a draft GitHub release with `latest.json` for the in-app updater.

Repository secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: contents of `~/.tauri/nacre-updater.key` (its public key is in `src-tauri/tauri.conf.json`).
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: empty for the generated key.

To rotate the key: `npx tauri signer generate -w ~/.tauri/nacre-updater.key`, then update the public key in `tauri.conf.json` and the secret. Builds are signed ad hoc (`signingIdentity: "-"`), not notarized: Gatekeeper asks for "Open Anyway" on first launch. An Apple Developer ID in the workflow removes that.
