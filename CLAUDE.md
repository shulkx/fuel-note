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
- `docs/plans/2026-10-21-insurance-benefits.md` (1.5 insurance, 1.7 benefits, 1.8 maintenance, 1.9 LLM recognition of other policies; design §20)
- `docs/plans/2026-10-22-fuel-expense-split.md` (1.6: 油耗 · 费用 · 设置 tabs, separate stats; design §21)

The predecessor userscript and the real data used for verification live in `E:\GitHub\xxyh`.

The owner's working preferences (language, UI copy, design-draft workflow, release habits) and Scripting-wide lessons live in `E:\scripting\CLAUDE.md` on the dev machine (not in this repo). Read it too.

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

On-device checks (`tools/check/README.md`): run these before asking the user to test on the phone.
- `npm run check:install` copies `tools/check` plus the app code to `../FuelNote Check`. The user opens it once and leaves it on screen; after that, reinstalling makes the phone rerun it with the new code.
- It switches the data folder to `FuelNoteCheck` (`setDataRoot`), so it never touches the real ledger, policy files, widget file, Keychain or 小熊.
- `XXYH_ROOT=E:/GitHub/xxyh npm run device-check` runs `recognize` (real policy files vs `expected.json`), `ledger` (import, linking, edits, mark upgrade, renewal, delete, backup/restore on a sandbox ledger), `shots` (policy detail, form, renewal; light and dark, full height) and `split` (1.6: a 小熊-linked car built from the latest backup inside the sandbox, never synced; fuel and expense totals and `widget.json` compared with the same pure functions on the PC, then screenshots of both tabs) and saves results to `XXYH_ROOT/out/check/`. Look at every screenshot before reporting.
- Still manual on the phone: real taps and gestures, system sheets (QuickLook, DocumentPicker, phone call), real 小熊 sync, the tab bar, and the first upgrade on the user's real data.

## Layering rules

- `common/` (except `model.ts`), `sync/xxyh/`, `providers/`, `stations/`, `readers/` and `platform/http.ts` are pure. They must not import `"scripting"` or touch Scripting globals (FileManager, Keychain, Dialog…), so the Node tests can load them. HTTP is injected as `Http`.
- Scripting-specific code lives in `platform/{scripting_http,storage,secrets,vision,assistant}.ts`, `common/model.ts`, `pages/`, `index.tsx`, `widget.tsx`, `tools/probe/` and `tools/check/`.
- Receipt recognition lives in `model.ts` `recognizeImage`: exactly one engine, from `settings.ocr_engine` (`local` = Vision + `receipt_rules.ts`, checked by `localUsable`; `azure` = `readers/azure.ts`; `assistant` = Scripting's `Assistant.requestStructuredData` with the account in `settings.ocr_assistant`, pure part in `readers/assistant.ts`; both LLM engines are checked by `receiptUsable`). No fallback between engines; unchecked results are still filled and flagged in the form. Composing the form draft is pure, in `common/draft.ts`; keep the form a thin consumer of it.
- `index.tsx` and `intent.tsx` (Shortcuts/share-sheet entry, 1.3) import only from `./pages/app`; `widget.tsx` imports only from `./common/widget_runtime` (since 1.2.1), which loads just widget_data, the status cache, storage, secrets and the providers, never the ledger or sync. This is a scripting-cli bundler limitation, see design §9.4. Add re-exports to `model.ts` / `widget_runtime.ts` when an entry needs something new. `common/widget_data.ts` still imports no other source file (model.ts imports it too). `tests/widget_imports.test.ts` checks the widget chain for cycles and heavy modules.
- The widget never reads the ledger. The app rewrites `widget.json` via `saveWidgetSnapshot` whenever data changes or a car status is read (`status_cache.json`, design §18); keep `WidgetSnapshot` in sync if the widget needs more fields. Display helpers the widget needs (`fuelRatio`, `fuelLow`, `statusWhen`…) live in `widget_data.ts` and are re-exported by `model.ts` for the pages.
- Standalone numbers use proportional digits. `monospacedDigit` is only for digits that must line up in columns or timers (Scripting text modifiers doc); on the widget's big numbers it spread 「11.60」 apart (fixed in 1.2.4).
- `script.json` declares `"intentInputTypes": ["Images"]` with `"runInApp": true`; keep them, a remote update replaces script.json and would otherwise drop the Shortcuts image input. `intent.tsx` reads `Intent.imagePathsParameter` (paths, no decode) and opens the fuel form with `initialImagePath`. In the Shortcut the screenshot must sit in the action's 「图像」 field (actions 「在 App 里运行意图」 foreground / 「运行意图脚本」 background); in 「参数」 it arrives as a file URL whose temp file is already deleted. Settings › 截屏记加油 explains the setup.
- Remaining fuel in the app is the「当前」section at the top of 油耗 › 记录 (`CurrentSection` in `pages/fuel_status.tsx`, text from `currentTank` in `common/widget_data.ts`, 1.3.1): a tinted card (green, orange when low, grey only when no status has been read yet), distinct from the white record cards. Never mark status stale by age: it is uploaded when the car is switched off, so an old report is still the current state; tap opens `StatusSheet`, pull-to-refresh re-reads. Not in the toolbar, not on Stats, not merged into the vehicle menu. The tab bar never minimizes (`tabBarMinimizeBehavior="never"`).
- 油耗 and 费用 are separate domains (design §21, 1.6). Fuel files (`common/fuel*.ts`, `pages/fuel_*.tsx`) never import expense or insurance files, and expense/insurance files (`common/expense*.ts`, `common/insurance*.ts`, `common/policy_text.ts`, `pages/expense_*.tsx`, `pages/insurance_*.tsx`, `pages/policy_*.tsx`) never import fuel ones; names imported from `common/model` are checked too (`tests/boundary.test.ts`). `common/fuel_stats.ts` takes `FuelRecord[]` only; the expense side goes through `expenseEntries` (`common/expense_stats.ts`), which merges a 小熊 maintenance record with the expense at the same timestamp so it is counted once (`maintenanceExpenses`, also used when converting to local). Shared: storage, sync, vehicles, settings, `common/ranges.ts`.
- Toolbar buttons that must be separate glass groups need the `<Toolbar>` component with one `ToolbarItem` per button and a `ToolbarSpacer` between them; an array under `topBarLeading` is merged into one capsule (1.3.1-beta.1).
- Widget look (1.4, design §18.2 「小组件改版（1.4）」): consumption is the hero; small, medium and large all have a horizontal 「记加油」 capsule button (small: bottom; medium/large: bottom of the left panel, never taking a metric cell). No vertical bar charts anywhere (user's rule); remaining fuel is a plain horizontal bar (no 15% gap marker), orange when low. Colours live in the `C`/`BUTTON`/`FILL`/`LEVEL` tables in `widget.tsx`; panel, cell and button backgrounds use `widgetBackground` so tinted mode hides them. Shape widths (the fuel bar) are computed from `Widget.displaySize`. Fields added to `widget.json` (1.4: `recent`, `year_cost`, `last_fuel_*`, `status.odometer_km`) appear only after the app runs once and rewrites the file; old files fall back to `EMPTY_WIDGET` defaults.
- Volvo car-status gRPC endpoints are server-streaming: read the first frame (`HttpRequest.stopWhen`) and disconnect; never wait for the response to end.
- Files are written through `writeAtomic` (tmp → `.bak` → rename); never write data files with `FileManager` directly.
- Use `Pasteboard` (not the deprecated `Clipboard`) and `Dialog.actionSheet` with `destructive` for delete or disconnect confirmations.
- In a pushed page, dismiss with `EnvironmentValuesReader keys={["dismiss"]}`; `Navigation.useDismiss` closes the whole presented app.
- **Scripting transpiles every file as TSX, `.ts` included.** `const f = <T>(v: T) => …` is read as a JSX tag. On the phone this surfaces as `SyntaxError: Unexpected token ','` or `Can't find variable: T`, while `tsc` passes. Write generics as function declarations (or `<T,>`), and never use `<T>value` casts. `tests/syntax.test.ts` parses every source as TSX to catch this.
- Edit forms decide 「有改动」 against what the fields showed when opened, not against the raw record: untouched fields keep the original value (`keptNumber` in common/form.ts), because 小熊 values often have more than two decimals. Saving an unchanged record dismisses without writing.
- Single-line `export { … } from` without a trailing comma, to match what the bundler is known to handle.
- Optional props such as `tabViewBottomAccessory`, `footer`, `systemImage` or `overlay`: omit the key entirely (conditional spread) instead of passing `undefined`; Scripting still renders an empty slot for `undefined`.
- Coordinates are WGS-84 everywhere inside the app. Convert at the boundaries: Volvo and AMap use GCJ-02; old 小熊 stations use BD-09.
- Vehicles (design §17): pages show `visibleVehicles` and `currentVehicle` (which skips hidden ones), never `data.ledger.vehicles` directly, except the settings lists. `setHidden` keeps at least one visible vehicle. The model catalogue is 小熊's public API in `sync/xxyh/catalog.ts`, cached by `model.ts` (`catalog_cache.json`). Never merge two vehicles' records; local ↔ 小熊 is a conversion (see the 小熊 sync invariants).
- Trips and refuel stops go only through `vehicleStops` / `cachedStops` in `model.ts`, the shared, cached detection (design §16.6). Never call a provider's `fetchTrips` from a page: the records reminder, the fuel form and the stop picker must share one request.
- Fuel-form trip rule (design §16.5): fill directly only when there is concrete evidence (the user tapped 「记一笔」 on a stop, or, from v1.1 phase 2, an image with a payment time). Generic entries (「+」, widget) only suggest a stop with 「填入」.
- Backup and restore (`common/backup.ts`) use Scripting's Node-compatible `crypto` via a lazy `require("crypto")`, so the same code runs in Node tests; never load it at module top level (a failure must not break app start). Restore replaces the whole ledger and xxyh state; 小熊-linked cars stay cloud-authoritative (pull right after restore, never upload backup records). Keep `secretItems()` in `model.ts` in sync when adding a credential.
- Custom components must not use prop names that Scripting reserves as view modifiers (`tag`, `badge`, …); tsc reports them as `(string | number) & …` type errors.
- Charts: selectable charts need string categories, and on the phone `chartXAxis` `values` is ignored for string categories, so every category is drawn. `common/chart_axis.ts` makes non-tick categories out of zero-width spaces; keep using it. A selection annotation with y overflow `disabled` draws above the plot, so put the chart in the same List row as whatever sits above it and leave room for it (`pages/fuel_stats.tsx` `chartRow`).
- A `frame` uses one form only: fixed `width`/`height`, or flexible `min*`/`max*`/`ideal*` (`FrameSizeProps` is a union). Mixing them type-checks, but Scripting then applies only the fixed size and drops `maxWidth` etc. (1.4.0-beta.1: the widget's 记加油 button shrank to its text). Use `minHeight`+`maxHeight` for a fixed height on a full-width view, `minWidth`+`maxWidth` for a fixed width with flexible height. `tests/syntax.test.ts` checks every `.tsx`.
- `ToolbarItem placement="largeSubtitle"` is not supported: Scripting renders it as a trailing toolbar item. Use `navigationSubtitle`; its spacing is set by the system.

## 小熊 sync invariants (do not regress)

- For linked vehicles, displayed data = `mapBackup(applyOps(base, ops))`. The cloud is the source of truth; local edits are an op log.
- Push always applies the ops to the **latest** cloud version, then runs `validateUpload`, which checks that everything except the touched records is byte-identical. Never bypass it.
- Patching an existing record writes only the fields whose values changed; unknown fields are preserved.
- Records are identified by `date` (`wc_id` is renumbered by the app on restore). Record ids look like `x:<car>:<f|e|m>:<date>[#n]`.
- Tests must never upload. `tests/helpers.ts` `readOnlyHttp` rejects writes.
- The only allowed change to the car list is `add_car`: cars are appended at the end, using the iOS-app + webapp field union (`newXxyhCar`), and `validateUpload` checks this. Never merge records into an existing car. Local ↔ 小熊 is a conversion (`convertToXxyh` creates a new cloud car; `convertToLocal` copies the records and ignores the cloud car). New cloud cars are not auto-added after the first connect (`newCars`, `xxyh_ignored_cars`). A linked car that disappears from the cloud is converted to local from the pre-deletion data before the base is replaced (`convertDeletedCars` in `doSyncXxyh`, which always pulls before pushing); restoring reuses `former_xxyh_car`.

## Versions

`script.json` `version` is the single source of truth. Settings › 版本 shows it via `Script.metadata.version`. `package.json` and the top `## x.y.z — date` heading of `CHANGELOG.md` must match; `tests/version.test.ts` enforces this.

- MINOR is a roadmap milestone: 1.1 = 自动填写与截图识别, 1.2 = 车况 (Volvo remaining fuel, design §18), 1.3 = 快捷指令 and the share sheet, 1.4 = 小组件重新设计, 1.5 = 保险, 1.6 = 油耗与费用分开 (design §21), 1.7 = 权益 (with LLM recognition of gifts and packages), 1.8 = 记保养, 1.9 = 大模型识别其他格式的保单 (design §20). Pre-releases `x.y.z-beta.n` are for on-device checks. In practice beta tags stay local (signed, not pushed): the user tests them through `npx scripting-cli start` in `E:\scripting`. If one is ever pushed it publishes as a GitHub pre-release, which `releases/latest` (and so auto-update) skips. PATCH covers fixes and small additions within a milestone. MAJOR is reserved for a data-format break (`schema_version`).
- Each batch handed to the user for on-device verification is a release:
  1. Add the CHANGELOG section first (user-facing wording, in Chinese).
  2. Run `npm run bump -- x.y.z`.
  3. Run `npm run check` and `XXYH_ROOT=E:/GitHub/xxyh npm test`, and commit only if both exit 0 (never chain them with `;`). Commit `release: x.y.z`.
  4. `git tag -s vx.y.z -m x.y.z`.
  5. Push `main` and the tag only when the user asks. The tag triggers `.github/workflows/release.yml` (same flow as Tiny Kick Counter): it checks the tag is on `main`, the version and `remoteResource`, runs `npm test`, zips only the runtime files into `FuelNote.zip`, and publishes a GitHub Release with that version's CHANGELOG section as notes. Afterwards wait for the run (`gh run watch`) and download `releases/latest/download/FuelNote.zip` to check `script.json` `version` (on the dev PC curl needs `--ssl-no-revoke`).
- `script.json` `remoteResource` points to `https://github.com/shulkx/fuel-note/releases/latest/download/FuelNote.zip` with `autoUpdateInterval` 86400. Data lives in the App Group directory and the Keychain, so updates never touch it; keep it that way (never store data under `Script.directory`).
- A new top-level runtime directory must be added to the workflow's 「Prepare package」 step; `tests/release.test.ts` fails otherwise. Pre-releases use `x.y.z-beta.n`.
- Tags: `v1.0.0` is cc2bdb4, the last commit before the v1.1 work.

## Commits

Commits are SSH-signed through 1Password (global git config). Never bypass signing.
