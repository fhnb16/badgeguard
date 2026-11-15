# AC697x / BR30 capability findings

These findings describe the captured E87 running `jl_sdk_ac697_publish` firmware `1.16.2.28`. They are not claims about every JieLi device.

E87 and Q87 map to the same `e87-ac697x` hardware profile when the AC697 SDK and AE00 service match. Receiver mode is identified by the Q87 name or the observed `47:89` MAC prefix; the `46:88` prefix identifies standard mode. Their Web Bluetooth device IDs differ, so each address still requires its own device selection.

## Transport and responses

- RCSP: AE01 write, AE02 notify.
- Watch-style sideband: FD02 write, FD01/FD03 notify; the GATT service UUID `C2E6FD00` is not itself a characteristic. No `FD00` characteristic was present in the capture.
- The observed advertising identifiers include service UUID `0xFD00` and manufacturer ID `0x6DB3`. These are advertisement filters, not proof of a GATT `FD00` characteristic.
- A 9E `0xFF` frame with `[echo, status]` is a generic transport ACK. It does not prove that the echoed command ran. Treat a matching FE response or expected sideband-data frame as evidence.
- The capability passport reports `qixFd00: false`; absence of that characteristic does not mean the separate FD02 sideband transport is absent.

## Captured features

| Command | Observation | Interpretation |
|---|---|---|
| RCSP `0x03` | FE response, 125-byte target-info TLV | Static passport fields received |
| RCSP `0x07` | FE response, 56-byte runtime-info TLV | Runtime attributes received |
| Sideband `C6` | `C7` response reports valid=1, 360×360, 368×368, and 4340 KiB available in the supplied frame | `C7` fields are parsed as valid byte, four little-endian dimensions, then a little-endian u32 memory value in KiB ([reference parser](https://github.com/guan4tou2/ebadge-python-cli/blob/main/ebadge_cli/badge_info.py)) |
| Sideband `0x27` | Two-byte battery push; 91–93% in supplied log | Battery level and mode |
| Sideband `0x22`, `0x24` | Frames received; no physical sensor support in the passport | Treat values as SDK stubs, not measurements |
| RCSP `0xE5` | A pull request for offset 0, length 8 was captured during an OTA attempt | Records observed pull transport for standard mode; does not establish image validity or enable flashing. Q87 receiver mode remains marked unsupported |
| Sideband `0xA0`, `0xAA`, `0xA6` | Historical probes received generic ACKs | `0xA0`/`0xA6` are sports-data SDK opcodes, `0xAA` remains unverified; none is evidence of a flash-read command |

## Attribute decoding

- The captured `0x03` target-info body is 123 bytes and parses into 17 TLVs with exact consumption. It does not contain a type-3/platform TLV; `03 05 00 01` is length 3, type 5 (`DEV_VERSION`), data `00 01`. TLV parsing now reports consumed/total bytes and logs malformed tails rather than silently dropping them.
- `0x03` uses `ATTR_TYPE_*`; `function_info` is a four-byte big-endian audio-function bitfield (`0x4E` means MUSIC, RTC, LINEIN, FM TX). It does not advertise file browsing.
- Target-info attr 8 (`DOUBLE_PARITION`) is kept distinct from runtime attrs. For captured `[00 01]`, the documented interpretation is single-bank with loader download required.
- `0x07` uses `COMMON_INFO_ATTR_*`; attr 5 is `FILE_BROWSE_TYPE` and the capture contains ASCII `ALL`.
- The captured `0x02 GET_TARGET_FEATURE_MAP` returned status `0x02` (unsupported command), so it is omitted from bootstrap. Feature-map decoding remains available for values carried by other attributes.
- `file_transfer=0x00000007` is recorded as a bitmask only. The bit semantics are not established by the cited vendor SDK.
- `dev_support_func` and peripheral bit labels remain speculative; raw bytes are preserved.
- Browse names retain their raw bytes and the header-indicated decode, with an alternate UTF-16LE/byte-string candidate when possible. The supplied 12-byte examples have header `0x0A`/`0x0B`, whose bit 1 indicates byte-string rather than UTF-16LE; no Unicode byte order is established for those values.
- `C7` available memory is recorded in KiB in a per-device/mode passport history and chart. The previous `f5` interpretation was an offset/endianness error; old `f5History` values are intentionally not migrated.
- Before content upload, BadgeGuard refreshes `C7` and requires `ceil(payloadBytes × 1.2 / 1024)` KiB. Unknown or insufficient capacity blocks the transfer; the 20% reserve is a conservative preflight heuristic, not a filesystem guarantee.
- BLE `fwVersion` remains the RCSP/SDK value. Product-version comparison (`R-VER`) uses only a manually recorded service-menu product version, stored per Web Bluetooth device ID. For example, enter `E87_EN`, `11.1.0.2`, and `251229` only for a device whose service menu shows that build; it is not assumed for every E87/Q87.

## Boundaries

- File browsing is evidenced by the capture. The experimental `0x24` cluster-transfer request currently receives status `0x01` on the reported AC697x files; the exact BR30 file-return layout remains unresolved. The public E87 browse implementation parses `0x0C` entry clusters as big-endian and does not implement `0x24` readback ([reference browser](https://github.com/guan4tou2/ebadge-python-cli/blob/main/ebadge_cli/file_browse.py)), so it does not support a little-endian `0x24` change. It is bounded to 16 MiB per file, and small watch-SDK files still use `0x28`.
- Resource manifests are scoped to the captured device ID, MAC, profile, and mode. A mode/device change clears stale browse results; `listedEntryCount` includes files and folders, `listedFileCount` counts files, and `count` counts resources actually fetched.
- The OTA probe sends only `0xE1`, `0xE2`, and `0xE6`; it does not enter update mode or send firmware. In the cited SDK, `0xE2` may return OK regardless of the image, so that reply is not proof that flashing is possible.
- An observed `0xE5` pull records transport evidence only; the AC697x profile still has `ota:false`. OTA writes remain gated, and FD03 is not treated as an OTA channel based on its properties alone.
- Auth-handshake exceptions close the connection and are surfaced to the user. Notifications are dispatched immediately rather than retained in a reusable packet queue; reconnect clears partial frame buffers and disconnect rejects pending waiters.
- The content queue is created only after the memory preflight and immediately before the `0x1B` file-metadata request. Completion requires all bytes to have been delivered, a `0x20` completion push, and a final `0x1C` status; a missing or non-zero final status is an error. `0x1C` is not sent speculatively as an abort command.
- Firmware transfer and reboot remain disabled for this AC697x profile; unknown opcode scanning and BLE flash dumping are also disabled.
- Full flash acquisition requires a wired UBOOT workflow; the browser can create a certificate for a user-provided wired dump but cannot perform the wired read.

The interactive `capability-matrix.json` export includes measured capture rows and any bounded probes performed in that session. No untested opcodes are presented as proven.
