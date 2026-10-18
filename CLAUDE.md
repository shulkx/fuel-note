# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

FuelNote (油记) is a fuel and vehicle-expense ledger script for the **Scripting** iOS app. It uses SwiftUI-wrapped TSX components; it is not a web or React project. It:

- records fuel and expenses locally;
- can sync with the 小熊油耗 (xiaoxiongyouhao) cloud backup;
- reads trips from vehicle data providers (Volvo China first) to fill odometer, time and station.

Before changing anything, read:

- `docs/specs/2026-10-18-fuelnote-design.md` (design)
- `docs/plans/2026-10-18-fuelnote-v1.md` (implementation plan and on-device checklist)

The predecessor userscript and the real data used for verification live in `E:\GitHub\xxyh`.

## Commands

```sh
npm run check                              # tsc against ../../dts (Scripting types); must pass
npm test                                   # tsx + node:test, synthetic data
XXYH_ROOT=E:/GitHub/xxyh npm test          # also checks against the real backup and trip archive (read-only)
LIVE=1 XXYH_ROOT=E:/GitHub/xxyh npm test   # also runs live read-only API calls
```

UI cannot run off-device. Run `npx scripting-cli start` in `E:\scripting` and test on the phone.

Local OCR samples (design §16.3): iOS Vision only runs on the phone.
- On the PC, run `npm run ocr-bridge`. It serves the images under `XXYH_ROOT/materials` on port 3100 and appends results to `XXYH_ROOT/out/ocr/vision.jsonl`.
- `npm run probe:install` copies `tools/probe` to `../FuelNote Probe`. On the phone, create an empty script with that name once, then run it.
- Samples and results never go into this repo.

## Layering rules

- `common/` (except `model.ts`), `sync/xxyh/`, `providers/`, `stations/`, `readers/` and `platform/http.ts` are pure. They must not import `"scripting"` or touch Scripting globals (FileManager, Keychain, Dialog…), so the Node tests can load them. HTTP is injected as `Http`.
- Scripting-specific code lives in `platform/{scripting_http,storage,secrets,vision}.ts`, `common/model.ts`, `pages/`, `index.tsx`, `widget.tsx` and `tools/probe/`.
- Receipt recognition lives in `model.ts` `recognizeImage`: exactly one engine, from `settings.ocr_engine` (`local` = Vision + `receipt_rules.ts`, checked by `localUsable`; `azure` = `readers/azure.ts`, checked by `receiptUsable`). No fallback between engines; unchecked results are still filled and flagged in the form. Composing the form draft is pure, in `common/draft.ts`; keep the form a thin consumer of it.
- `index.tsx` imports only from `./common/model` and `./pages/app`; `widget.tsx` imports only from `./common/widget_data`, which imports no other source file. This is a scripting-cli bundler limitation, see design §9.4. Add re-exports to `model.ts` when the app entry needs something new.
- The widget never reads the ledger. The app rewrites `widget.json` via `saveWidgetSnapshot` whenever data changes; keep `WidgetSnapshot` in sync if the widget needs more fields.
- Files are written through `writeAtomic` (tmp → `.bak` → rename); never write data files with `FileManager` directly.
- Use `Pasteboard` (not the deprecated `Clipboard`) and `Dialog.actionSheet` with `destructive` for delete or disconnect confirmations.
- In a pushed page, dismiss with `EnvironmentValuesReader keys={["dismiss"]}`; `Navigation.useDismiss` closes the whole presented app.
- **Scripting transpiles every file as TSX, `.ts` included.** `const f = <T>(v: T) => …` is read as a JSX tag. On the phone this surfaces as `SyntaxError: Unexpected token ','` or `Can't find variable: T`, while `tsc` passes. Write generics as function declarations (or `<T,>`), and never use `<T>value` casts. `tests/syntax.test.ts` parses every source as TSX to catch this.
- Single-line `export { … } from` without a trailing comma, to match what the bundler is known to handle.
- Optional props such as `tabViewBottomAccessory`, `footer`, `systemImage` or `overlay`: omit the key entirely (conditional spread) instead of passing `undefined`; Scripting still renders an empty slot for `undefined`.
- Coordinates are WGS-84 everywhere inside the app. Convert at the boundaries: Volvo and AMap use GCJ-02; old 小熊 stations use BD-09.
- Trips and refuel stops go only through `vehicleStops` / `cachedStops` in `model.ts`, the shared, cached detection (design §16.6). Never call a provider's `fetchTrips` from a page: the records reminder, the fuel form and the stop picker must share one request.
- Fuel-form trip rule (design §16.5): fill directly only when there is concrete evidence (the user tapped 「记一笔」 on a stop, or, from v1.1 phase 2, an image with a payment time). Generic entries (「+」, widget) only suggest a stop with 「填入」.
- Custom components must not use prop names that Scripting reserves as view modifiers (`tag`, `badge`, …); tsc reports them as `(string | number) & …` type errors.
- Charts: selectable charts need string categories, and on the phone `chartXAxis` `values` is ignored for string categories, so every category is drawn. `common/chart_axis.ts` makes non-tick categories out of zero-width spaces; keep using it. A selection annotation with y overflow `disabled` draws above the plot, so put the chart in the same List row as whatever sits above it and leave room for it (`pages/stats.tsx` `chartRow`).
- `ToolbarItem placement="largeSubtitle"` is not supported: Scripting renders it as a trailing toolbar item. Use `navigationSubtitle`; its spacing is set by the system.

## 小熊 sync invariants (do not regress)

- For linked vehicles, displayed data = `mapBackup(applyOps(base, ops))`. The cloud is the source of truth; local edits are an op log.
- Push always applies the ops to the **latest** cloud version, then runs `validateUpload`, which checks that everything except the touched records is byte-identical. Never bypass it.
- Patching an existing record writes only the fields whose values changed; unknown fields are preserved.
- Records are identified by `date` (`wc_id` is renumbered by the app on restore). Record ids look like `x:<car>:<f|e|m>:<date>[#n]`.
- Tests must never upload. `tests/helpers.ts` `readOnlyHttp` rejects writes.

## Versions

`script.json` `version` is the single source of truth. Settings › 版本 shows it via `Script.metadata.version`. `package.json` and the top `## x.y.z — date` heading of `CHANGELOG.md` must match; `tests/version.test.ts` enforces this.

- MINOR is a roadmap milestone: 1.1 = 自动填写与截图识别, 1.2 = 快捷指令 and the share sheet. PATCH covers fixes and small additions within a milestone. MAJOR is reserved for a data-format break (`schema_version`).
- Each batch handed to the user for on-device verification is a release:
  1. Add the CHANGELOG section first (user-facing wording, in Chinese).
  2. Run `npm run bump -- x.y.z`.
  3. Commit `release: x.y.z`.
  4. `git tag -s vx.y.z -m x.y.z`.
- Tags: `v1.0.0` is cc2bdb4, the last commit before the v1.1 work.

## Commits

Commits are SSH-signed through 1Password (global git config). Never bypass signing.
