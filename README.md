# BadgeGuard

Browser-based inspection and safe device tools for JieLi BLE badges. The app builds as a single-file page and as an offline PWA:

- `dist-single/index.html` — standalone page.
- `dist/` — PWA assets.

The project has no JavaScript runtime dependencies. Build locally with `node build.mjs`; unit tests are `node tests/run.mjs`. GitHub Actions builds both distributions and uploads them with the root-level `ota-helper.php` as one workflow artifact without installing Node or project packages. Branch pushes also commit regenerated `dist/` and `dist-single/` files back to that branch. Pushing a `v*` tag publishes a versioned PWA ZIP, standalone HTML, and `ota-helper.php`.

## Optional cloud OTA availability check

The device tools include a manual, single-request checker for the listed ZRun/Zijun endpoints. It never loops through endpoints, retries automatically, sends `authKey` or uploads a firmware image. Candidate JieLi URLs are displayed but disabled because their request schema is unknown; repository and app-store links are not API endpoints. A returned download URL is shown for an explicit user click and is never flashed automatically.

The source `ota-helper.php` is at the repository root; the build copies it beside `index.html` in both `dist/` and `dist-single/`. It makes one HTTPS POST to a fixed endpoint allowlist. To use it locally, set `BADGEGUARD_OTA_AES_KEY` in the environment to the 16-byte app key from a source you are authorized to use, then serve either distribution on loopback:

```powershell
$env:BADGEGUARD_OTA_AES_KEY = "<configured locally; do not commit>"
php -S 127.0.0.1:8765 -t dist
```

Open `http://127.0.0.1:8765/` and expand the cloud OTA checker. For `dist-single/`, run the same command with `-t dist-single`. A relative `ota-helper.php` URL is the default and needs no helper token when the page and helper share an origin. PHP's OpenSSL extension is required. The key is intentionally not bundled in the repository. The app sends only the selected endpoint ID, `model`, and `version` to the helper; do not enter the device auth key as `model`.

For a cross-origin remote PHP helper, configure `BADGEGUARD_OTA_AES_KEY`, `BADGEGUARD_OTA_ALLOWED_ORIGIN` (the exact BadgeGuard origin), and a random `BADGEGUARD_OTA_HELPER_TOKEN` of at least 32 characters. Enter the helper's HTTPS URL and token in the app. Do not expose the helper without both origin and token settings. The PHP helper has no arbitrary-URL proxy feature and only accepts endpoint IDs in its source allowlist.

## Confirmed AC697x / BR30 behavior

- RCSP uses AE01/AE02. The E87 capture has FD01–FD05 sideband characteristics but **no FD00 characteristic**; `qixFd00` is therefore false.
- A generic 9E `0xFF` ACK confirms transport receipt only. Command success requires a real FE response or a relevant sideband data frame.
- The captured AC697x stock firmware did not return data for the Qix `0xA0` / `0xAA` / `0xA6` flash-read path. BLE raw dump is disabled for this profile.
- `function_info` and runtime `sysInfo` are decoded in separate attribute namespaces. Speculative fields retain their raw hex.
- A bounded Raw Probe permits only known read-only commands. No write-capable opcode sweep is exposed.
- File-browser/resource access, read-only OTA status probing, battery/screen/time inspection, health-stub labeling, and image upload are grouped under Device tools. Hardware-dependent results are not pre-assumed.

See [docs/BR30-CAPABILITIES.md](docs/BR30-CAPABILITIES.md) for evidence and limitations.
