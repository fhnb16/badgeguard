# BadgeGuard

Browser-based inspection and safe device tools for JieLi BLE badges. The app builds as a single-file page and as an offline PWA:

- `dist-single/index.html` — standalone page.
- `dist/` — PWA assets.

The project has no runtime dependencies. Build locally with `node build.mjs`; unit tests are `node tests/run.mjs`. GitHub Actions builds both distributions and uploads them as one workflow artifact without installing Node or project packages. Branch pushes also commit regenerated `dist/` and `dist-single/` files back to that branch. Pushing a `v*` tag publishes a GitHub release with a versioned PWA ZIP and standalone HTML file.

## Confirmed AC697x / BR30 behavior

- RCSP uses AE01/AE02. The E87 capture has FD01–FD05 sideband characteristics but **no FD00 characteristic**; `qixFd00` is therefore false.
- A generic 9E `0xFF` ACK confirms transport receipt only. Command success requires a real FE response or a relevant sideband data frame.
- The captured AC697x stock firmware did not return data for the Qix `0xA0` / `0xAA` / `0xA6` flash-read path. BLE raw dump is disabled for this profile.
- `function_info` and runtime `sysInfo` are decoded in separate attribute namespaces. Speculative fields retain their raw hex.
- A bounded Raw Probe permits only known read-only commands. No write-capable opcode sweep is exposed.
- File-browser/resource access, read-only OTA status probing, battery/screen/time inspection, health-stub labeling, and image upload are grouped under Device tools. Hardware-dependent results are not pre-assumed.

See [docs/BR30-CAPABILITIES.md](docs/BR30-CAPABILITIES.md) for evidence and limitations.
