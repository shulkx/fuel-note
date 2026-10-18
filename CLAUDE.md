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

## Layering rules

- `common/` (except `model.ts`), `sync/xxyh/`, `providers/`, `stations/` and `platform/http.ts` are pure. They must not import `"scripting"` or touch Scripting globals (FileManager, Keychain, Dialog…), so the Node tests can load them. HTTP is injected as `Http`.
- Scripting-specific code lives in `platform/{scripting_http,storage,secrets}.ts`, `common/model.ts`, `pages/`, `index.tsx` and `widget.tsx`.
- Entry files import only from `./common/model`; `index.tsx` additionally imports `./pages/app`. This is a scripting-cli bundler limitation, see design §9.4. Add re-exports to `model.ts` when an entry needs something new.
- Coordinates are WGS-84 everywhere inside the app. Convert at the boundaries: Volvo and AMap use GCJ-02; old 小熊 stations use BD-09.

## 小熊 sync invariants (do not regress)

- For linked vehicles, displayed data = `mapBackup(applyOps(base, ops))`. The cloud is the source of truth; local edits are an op log.
- Push always applies the ops to the **latest** cloud version, then runs `validateUpload`, which checks that everything except the touched records is byte-identical. Never bypass it.
- Patching an existing record writes only the fields whose values changed; unknown fields are preserved.
- Records are identified by `date` (`wc_id` is renumbered by the app on restore). Record ids look like `x:<car>:<f|e|m>:<date>[#n]`.
- Tests must never upload. `tests/helpers.ts` `readOnlyHttp` rejects writes.

## Commits

Commits are SSH-signed through 1Password (global git config). Never bypass signing.
