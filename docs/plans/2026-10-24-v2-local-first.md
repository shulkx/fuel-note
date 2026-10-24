# 油记 2.0：以油记为准 — 实施文档

- 设计：`docs/specs/2026-10-24-local-first.md`（用户 2026-10-24 确认）。后续：2.1 记保养与沃尔沃养修（`docs/specs/2026-10-24-maintenance-volvo.md`），2.2 大模型识别保单。
- 目标：数据全部存在本机，记录有固定的 id，关联和门店改成字段；小熊只做导入和手动导出；现有数据在电脑上转换一次；备份改成 zip 并自动备份到 iCloud 云盘；顺带删掉诊断、旧迁移等不再需要的代码，拆开 `model.ts`。
- 约定沿用 `CLAUDE.md`：纯逻辑放 `common/`、`sync/`、`stations/`、`readers/`；入口只从一个模块导入，单行 `export { … } from` 不加结尾逗号；泛型写成函数声明或 `<T,>`；frame 不混写；可选属性不传 `undefined`；数据文件都经过 `writeAtomic`。
- 每个测试版：先写 CHANGELOG → `npm run bump -- x.y.z` → `npm run check` 和 `XXYH_ROOT=E:/GitHub/xxyh npm test` 都退出 0 才提交（不用 `;` 串起来）→ `git tag -s`，不推送 → 跑 FuelNote Check、看完截图 → 再请用户看剩下的项目。

## 状态（2026-10-24）

- 2.0.0-beta.1 已实现（见下）。
- 2.0.0-beta.2 已实现，用户已切换真实数据（2026-10-24）。和计划不同的地方写在 beta.2 一节开头。
- 2.0.0-beta.3：「为数据写功能」的审查（max agent，2026-10-24）之后的清理已做完（见 beta.3 一节开头），zip 备份和自动备份还没做。
- 开工前（已做）：工作区里 2.1 要用的改动（`providers/volvo_cn.ts` 的 POST 签名和 `volvoGateway`、`tests/providers.test.ts`、`tools/volvo_service_probe.ts`、`docs/specs/2026-10-23-xxyh-mapping.md`）和这几份设计、实施文档，先单独提交，不混进 beta.1。

## 请用户配合的

1. 测试期间关掉「设置 › 同步 › 小熊油耗 › 保存后自动上传」。
2. 现在在 1.7 里「备份到文件」（不含凭据），传到电脑放进 `E:\GitHub\xxyh\out\fuelnote\`，用来核对真实数据：没上传的修改、保险 id 的格式、备注最后一行的写法。
3. 装上 2.0.0-beta.1 后，隔天看一次「设置 › 版本」，确认每天的自动更新没有把测试版换回 1.7。
4. 切换到 beta.2 当天再备份一次，转换重跑一遍。

## 2.0.0-beta.1：和同步无关的删减和小修

数据格式不变，同步照旧。只删、只整理，不改账本结构。

### 删掉

- [x] 车况诊断：`pages/provider_settings.tsx` 的原始字段和「诊断请求方式」；`platform/scripting_http.ts` 的 `probeBinaryPost`；`common/model.ts` 的 `diagnoseVehicleStatus`；`providers/volvo_cn.ts` 只给它用的 `volvoStatusRequest`；`VehicleStatus.raw`（`providers/grpc.ts` 的 `pbDump` 留着，测试还用）。设置里「读取车况」的数值照旧。
- [x] 小组件诊断：`widget.tsx` 的「诊断」参数；`common/widget_refresh.ts` 的 `log`、`WidgetRefreshLog`，`common/widget_runtime.ts` 写 `widget_status_log.json` 和 `lastWidgetRefresh`；`WidgetSnapshot.pending`。
- [x] 交强险标志的旧迁移：`upgradeInsuranceMarks`、`upgradeYearMarks`、`MarkFiles`、`Settings.insurance_marks_checked`（读账本时去掉）、启动时的调用、FuelNote Check 里那一步和它的测试。
- [x] 「导出记录」：`exportData` 和设置里的入口。`writeExport` 改成 `writeRestoreCopy`，只给恢复前的副本用。
- [x] 死代码和过时注释：`initialImage` 只收 `UIImage`（去掉按路径读的分支和 `filePathOf`）；`receipt.ts` 里说会换引擎再试的注释；`model.ts`、`ledger.ts` 里重复的文档注释；`model.ts` 文件头；`CLAUDE.md` 里 `initialImagePath` 的说法。
- 权益表单的 `scanned` 不删：FuelNote Check 用它截「添加权益（识别后）」，只有三行。

### 改

- [x] 油站搜索改成开关（`pages/station_search_settings.tsx`）；`StationSearchMode` 只有 `"auto"`、`"off"`，旧的 `"amap"`、`"xxyh"` 读成 `"auto"`；`rawSearcher` 简化。
- [x] 删除车辆连带删除（本机车辆）：`common/ledger.ts` 的 `vehicleDeletion(ledger, id)` 返回删掉后的账本、记录条数、保险年度 id、权益项数；`model.ts` 的 `deleteVehicle` 用它并删保单原件，`vehicleDeletionCounts` 给确认框。
- [x] `common/format.ts`：`BJ_OFFSET`、`bjDayStart`、`grouped`、`yuan`、`yuanShort`。替换了 `perks.ts` 的 `money2`、`moneyShort`，`insurance_parts.tsx` 的 `yuan`（页面改从 `common/model` 导入），`insurance.ts`、`policy_text.ts`、`insurance_form.tsx`、`benefit_form.tsx` 的北京时间和千分位，`model.ts` 里手写的月份（改用 `monthKey`）。没合并的：`pages/components.tsx` 的 `money`（油耗页用，不带千分位，空值写「—」）、`draft.ts` 的「x.xx 元」、`insurance.ts` 的 `amountText`（整万写「万」），写法本来就不同。
- [x] 存储层可测：`common/files.ts`（纯）有 `Fs`、`writeAtomic`、`readJson`、`readCacheFile`、`readLedgerFile`、`pruneCopies`、`removeLegacyCaches`；`platform/storage.ts` 只提供 Scripting 的 `FileManager`，原有函数签名不变。缓存移到 `FuelNote/cache/`，`loadData` 时删掉根上的旧缓存；坏文件、恢复前副本只留最近 5 份。
- [x] FuelNote Check：去掉标志迁移那一步，README 跟着改；`STAMP` 25。

### 测试

- [x] `tests/storage.test.ts`（新，8 项）、`tests/pure_layer.test.ts`（新，例外是 `model.ts`、`widget_runtime.ts`、`widget_data.ts`）、`tests/format.test.ts`（新，2 项）、`tests/vehicles.test.ts` 加删除车辆。
- [x] 改：`status_cache`、`vehicle_status`、`widget_refresh`（去掉 `raw` 和日志，改看读了几次、写了几次、锁）；删掉标志迁移的测试。全部 216 项，214 项通过，2 项跳过。

### 文档和发布

- [x] `CHANGELOG.md` 2.0.0-beta.1；`CLAUDE.md`（必读文档、路线图、快捷指令传图、存储和缓存）；`README.md`（油站搜索、缓存、恢复前副本、去掉导出记录）；设计文档 18.3 节小组件诊断的一句。
- [x] `docs/plans/2026-10-21-insurance-benefits.md`：1.8、1.9 两节换成一句，指向 2.1、2.2。

## 2.0.0-beta.2：以油记为准

设计第 3–5、8、9 节。先冻结旧代码、写转换脚本并用真实备份反复跑，再删同步。

完成情况（2026-10-24）：除最后的「切换」外都已完成。和下面写的不同：

- 转换脚本不拆门店，也没有白名单：备注原样留着；用户不要的 5 笔洗车（清洗护理）在转换结果里直接删掉（一次性脚本，不进仓库）。
- 没有冻结 1.7 的代码（`tools/legacy_v1/`）：转换脚本要求备份里没有待上传的修改，用不到 `applyOps`、`computeMirror`；1.x 的编号按 `recordsFromCar` 的固定顺序推出来（`legacyIds`）。`tsconfig.json` 只加了 `tools/migrate_v2_core.ts`。
- 合成的 1.7 备份写在 `tests/migrate_v2.test.ts` 里，没有单独的 `tests/fixtures/v17_backup.json`。
- 测试文件名：导入和映射在 `tests/xxyh_import.test.ts`（`xxyh_ops.test.ts` 删掉），分层和循环导入在 `tests/layers.test.ts`。
- 权益相关的处理还在 `pages/app.tsx`，没有拆到 `pages/benefit_actions.ts`。
- `Perk.store` 仍是文字，门店按 id 放到 2.1。
- 主设计文档只在第 7、17 节开头加了指向 2.0 设计的说明，其余几节里说同步的地方留到 2.0 发布前一起改。

### 冻结 1.7 的代码，写转换脚本

- [x] `tools/legacy_v1/`：从当前代码复制转换要用的部分，只改导入路径，不改逻辑：`types.ts`（1.x 的账本、小熊状态、记录类型）、`ops.ts`（`applyOps`）、`mapping.ts`（`mapBackup`、`xxyhRecordId`、`parseXxyhRecordId`）、`mirror.ts`（`computeMirror`、`linkInsuranceExpenses`、`maintenanceExpenses`）、`remark.ts`（`splitRemark`、`usageLine`、`remarkStore`）、`backup.ts`（1.x 的 `parseBackup`）。文件头写明「冻结的 1.7 代码，只给 migrate_v2 用，不进发布包」。
- [x] `tsconfig.json` 的 include 加上 `tools/**/*.ts`（`tools/check`、`tools/probe` 是 Scripting 代码，按现有方式排除或单独处理，保证 `npm run check` 通过）。
- [x] `tools/migrate_v2.ts`：`XXYH_ROOT=… npx tsx tools/migrate_v2.ts <1.x 备份> [--stores <白名单>]`。纯函数 `migrateV1(backup, whitelist): { ledger: LedgerFileV2; xxyh: XxyhStateV2; snapshot; report }` 放在同目录的 `migrate_v2_core.ts`，测试直接调它。规则照设计第 5 节第 2 步：
  - 用 `computeMirror` 得到每辆小熊车显示的记录（含没上传的修改；冲突的记进报告）；
  - 生成新 id、带 `xxyh_raw`（取 `applyOps` 之后的那份原样）；保养存成 `MaintenanceRecord`，按同一时刻配好 `expense_id`；
  - 小熊记录以外的 id 不变；权益使用按 `expense_ts` 找费用（恰好一笔才写，否则记进报告）；保险年度的 `x:` id 用 `parseXxyhRecordId` 找到记录换成新 id；
  - （取消，见本节开头）门店拆分：最后一行等于按这笔费用的使用记录生成的 `usageLine`，或等于已有门店名，或在白名单里；关联了保险的费用不拆；权益卡的店名找到或新建门店；
  - 费用类别以小熊 `expenseTypes`（`sortId`）为准，补本机独有的；油站全部复制；车型资料复制到 `profile`；
  - 小熊状态：`account_id`、`nickname`、`last_version = base_version`，base 作为快照；
  - 检查：每辆车每种记录条数相同、`ledgerProblems` 为空，不通过就不写文件。
  - 输出到 `XXYH_ROOT/out/fuelnote/`：`backup-v2.json`（2.0 的 `backup.json`）、`report.md`（不进仓库）。屏幕只打印条数和报告路径，不打印备注、金额、门店名。
- [x] `tests/fixtures/v17_backup.json`（合成，不含真实数据）：一辆关联小熊的车（含没上传的修改，其中一条冲突）、一辆本机车、一辆隐藏的车、带 `#n` 的保险 id、只有金额的车险、各种备注最后一行（权益用量 + 门店、只有门店、像店名但不是的、用户自己写的）、同一时刻的保养和费用、小数毫秒、以换行结尾的备注。
- [x] `tests/migrate_v2.test.ts`：条数相同；`ledgerProblems` 为空；使用记录、保险年度都换成新 id；门店只按规则拆，白名单生效，保险费用不拆；本机记录 id 不变；没上传的修改带上、冲突的进报告；`xxyh_raw` 保留小数毫秒和结尾换行；重复运行结果相同。`XXYH_ROOT` 下有用户的 1.7 备份时，再跑一遍并检查同样的不变量。

### 数据格式和读写

- [x] `common/types.ts`：照设计第 3 节改成 2.0 的类型（`LedgerFile.schema_version: 2`、必填数组、`LocalRecord` 含保养、`store_id`、`expense_id`、`xxyh_raw`、去掉 `origin`/`pending`/`xxyh_ignored_cars`/`xxyh_auto_upload`/`former_xxyh_car`）。`sync/xxyh/types.ts`：`XxyhState` 改成 v2，删掉 `XxyhOp`。
- [x] `common/ledger_file.ts`（新，纯）：`normalizeLedger(raw)`（补字段、`station_search` 旧值、保留不认识的字段）、`ledgerProblems(ledger)`（所有引用）、`isLegacyLedger(raw)`。
- [x] `common/files.ts` / `platform/storage.ts`：账本、小熊状态写 `ledger2.json`、`xxyh2.json`；只读到 1.x 的 `ledger.json` 时返回 `{ legacy: true }`，不另存坏文件、不写任何文件。
- [x] `common/ledger.ts` 重写：
  - `AppData = { ledger, xxyh }`，去掉 `Mirror`、`computeMirror`、`pendingCount`、`isLinked`、`parseXxyhRecordId` 的使用；`vehicleRecords`、`stationsFor`、`categoriesFor` 只读账本。
  - `putFuel`、`putExpense`：编辑时合并原记录的 `xxyh_raw`、`store_id`（表单没改门店时）、保养的 `expense_id`。
  - `removeRecord`：删费用时删掉它的使用记录、清空指向它的保险年度和保养的 `expense_id`；删保养记录时不删费用（2.1 再做保养行一起删）。
  - 保险：`putInsurance` 直接更新 `expense_id` 指向的费用；删掉保存后的 `linkInsuranceExpenses`、`GENERATED_REMARK`。`pages/insurance_form.tsx` 的「补到已有的费用」「保留原金额 / 改成保单合计」照旧（候选费用按 id），测试覆盖：导入的数据上记一年保险，补到那笔已有的费用，费用统计里只算一次。
  - `vehicleDeletion` 对所有车生效（`model.ts` 去掉「小熊车辆不能删」）。
  - 删掉 `convertToXxyh`、`convertToLocal`、`materialize`、`materializeAll`、`vehiclesForCars`、`newCars`、`setCarIgnored`、`carUuidFor`、`deletedCars`、`convertDeletedCars`、`rebaseSync`、`deletedCarsNotice`。
- [x] `common/perks.ts`、`common/perk_ledger.ts`：使用记录按 `expense_id`；`expenseUses`、`usedOf`、`usablePerks` 跟着改；`splitRemark`、`joinRemark`、`usageLine` 不再用于存取，`usageLine` 留给导出（beta.4）。
- [x] `common/stores.ts`：门店按 id；`storeCandidates` 只列 `ledger.stores`；`remarkStore` 只在「没有 `store_id` 的旧费用显示备注最后一行」时用。
- [x] `common/expense_stats.ts`：`maintenanceExpenses` 按 `expense_id` 配对。
- [x] `common/insurance.ts`：`isCarInsurance` 先看 `expense_id`；只有金额的车险规则照旧。

### 导入

- [x] `sync/xxyh/import.ts`（新，纯）：`importCars(backup, uuids, ledger, now)`：选中的车导入成油记车辆和记录（新 id、`xxyh_raw`、保养配好 `expense_id`、不拆门店），油站全部复制、类别补齐、`profile` 从车型资料复制；返回新账本和每辆车的条数。规则和 `migrate_v2_core.ts` 里的记录部分共用一个函数（`recordsFromCar`），放在 `sync/xxyh/import.ts`，转换脚本从这里导入。
- [x] `sync/xxyh/sync.ts` 只剩 `download(http, token)`（账号信息 + 最新版本）和 `upload`（beta.4 用）；删掉 `pull`、`push`。`sync/xxyh/ops.ts` 删掉（已复制到 `tools/legacy_v1/`）。
- [x] `mapping.ts`：删掉 `xxyhRecordId`、`parseXxyhRecordId`、`idFor`；`mapBackup` 改成 `recordsFromCar` 用的映射；`patchXxyhFuel`、`patchXxyhExpense` 留给 beta.4。

### `app/` 和 `model.ts`

- [x] 新建 `app/`（Scripting 代码，可以用全局对象）：`store.ts`（读写账本、提交、`DataRef`）、`policy_files.ts`、`xxyh_io.ts`（连接、导入、没导入的车）、`vehicle_data.ts`（车况、行程、停车、车型库缓存）、`stations.ts`、`recognize.ts`、`backup.ts`、`widget_snapshot.ts`、`prefs.ts`（设置、点过「×」的提醒）。`app/*` 互相可以导入，不导入 `common/model.ts`。
- [x] `common/model.ts` 只做转出（单行 `export { … } from`，不加结尾逗号）；页面照旧只从它导入。
- [x] `app/` 加进 `.github/workflows/release.yml` 的「Prepare package」、`tools/install_check.mjs` 的 `DIRS`、`tsconfig.json`；`tests/release.test.ts` 照旧通过。
- [x] `tests/boundary.test.ts`：从 `common/model` 导入的名字按转出的来源检查；`tests/import_cycles.test.ts`（新）：从 `index.tsx` 出发没有循环导入，`app/*` 不导入 `common/model.ts`。
- [x] 删掉 `syncXxyh`、`doSyncXxyh`、`autoSync`、`afterChange`、`waitForPendingSync`、`syncStatusText`、`pendingForVehicle`、`xxyhNewCars`、`xxyhIgnoredCars`、`addXxyhCar`、`setXxyhCarIgnored`、`convertVehicleToXxyh`、`convertVehicleToLocal`、`commitRelinked`、`upgradeInsuranceMarks`（beta.1 已删）；`commit` 只写一个文件。

### 页面

- [x] `pages/app.tsx`：
  - 一个 `mutate(label, change)`：保存、刷新小组件、闪一下提示；替换现在 7 处「保存 → 提示 → 同步」；`requireVehicle()` 替换 3 处「还没有车辆」；读写统一叫 `DataRef`。
  - 权益相关的处理移到 `pages/benefit_actions.ts`；`storeByName`、`keptExpenses` 改成按 id。
  - 去掉 `applySync`、启动和回前台的 `autoSync`、`syncAll`、新车提示、「保养记录请在小熊油耗 App 中修改」；`runApp` 不再等同步。
  - 打开时 `legacy` 为真：只显示说明页（设计第 5 节第 6 步），有「恢复备份…」和「从小熊油耗导入…」两个按钮。
- [x] `pages/components.tsx`：去掉 `PendingTag`、`AppActions.sync`。`fuel_records.tsx` 的下拉只刷新车况；`expense_records.tsx`、`insurance_tab.tsx`、`benefit_tab.tsx` 去掉下拉刷新和副标题里的同步状态。
- [x] `pages/fuel_form.tsx`：选油站改用 `stationsFor`，不再自己判断小熊。
- [x] `pages/expense_form.tsx`：门店存 `store_id`；备注只显示、保存用户写的内容；去掉「同步到小熊」的脚注。`pages/expense_records.tsx`：第二行的门店从 `store_id` 读，没有时照旧取备注最后一行。
- [x] `pages/insurance_detail.tsx`、`pages/benefit_detail.tsx`：去掉「可能在小熊油耗里被删除了」「没有对应的费用」里说小熊的文字；只在 `expense_id` 找不到时显示「没有对应的费用」。
- [x] 车辆：`pages/vehicle_add.tsx` 去掉「保存位置」；`pages/vehicle_edit.tsx` 去掉「转为小熊车辆 / 本机车辆」，加「导出到小熊的车」（列出小熊里的车和「不导出」；beta.4 之前只存不导出），删除对所有车开放；`pages/vehicle_menu.tsx` 不再分组。
- [x] `pages/xxyh_settings.tsx` 重写：凭据；「从小熊油耗导入…」（勾选车辆）；「小熊里还没导入的车」；断开（只删凭据和小熊状态，不动数据）。
- [x] `pages/settings.tsx`：「同步」一组改成「小熊油耗」，第二行写账号和「上次导入 / 导出」。
- [x] `pages/backup_settings.tsx`：去掉「N 条修改还没上传 / 立即上传」「保留未上传的修改」、恢复后同步；摘要去掉「连接小熊油耗的车」「版本」。这一版备份仍是一个 JSON 文件，`backup.json` 的 `version` 2。

### 备份（JSON，2.0 格式）

- [x] `common/backup.ts`：`BACKUP_VERSION = 2`；`BackupFile` 带 v2 的账本、v2 的小熊状态和精简快照（`cars`、`myStations`、`expenseTypes`）；`parseBackup` 只认 2，遇到 1 抛「这是 1.x 的备份，请先在电脑上转换」；删掉 `restoredXxyh`；摘要按 v2 统计。
- [x] `app/backup.ts`：恢复经过 `normalizeLedger`，`ledgerProblems` 不为空时在预览里列出；恢复前副本（1.x 数据时复制 `ledger.json`、`xxyh.json` 原文件）；恢复后重写 `widget.json`。

### FuelNote Check

- [x] `tools/check/runner.tsx`：`/run/split` 改用 `importCars` 建车（不再有 `xxyh.json` 的 base、不调 `applyOps`）；`/run/ledger` 去掉 `keepOps`；新增 `/run/migrated`：电脑发来 `backup-v2.json`，在沙盒里恢复，回报每辆车的条数、保险年度和费用的对应、权益使用和费用的对应、门店，截油耗、费用、保险、权益四页和一笔有门店的费用。`STAMP` 加一。
- [x] `tools/device_check.ts`：去掉 `origin`、`pending`；`migrated` 一项读 `XXYH_ROOT/out/fuelnote/backup-v2.json`，用同一套纯函数算期望值；`split` 的期望值改用 `importCars`。
- [x] `tools/check/README.md`：写明 `migrated`。

### 测试

- [x] 改写：`tests/ledger.test.ts`（编辑合并 `xxyh_raw`/`store_id`/`expense_id`、删费用清关联、删车）、`insurance_ledger.test.ts`（按 id）、`perk_ledger.test.ts`（按 `expense_id`）、`backup.test.ts`（v2、拒绝 v1）、`expense_stats.test.ts`（保养按 id 配对）、`real_data.test.ts`（导入真实备份后条数、合计照旧）、`vehicles.test.ts`。
- [x] 新增：`tests/import.test.ts`（合成小熊备份导入：条数、`xxyh_raw`、保养配对、油站、类别顺序）、`tests/ledger_file.test.ts`（`normalizeLedger` 保留不认识的字段、`ledgerProblems` 认出每种断开的引用、`isLegacyLedger`）。
- [x] 删掉：`tests/xxyh_ops.test.ts` 的操作部分（凭据、映射、油站 id、类别排序的用例留下，移到 `tests/xxyh_mapping.test.ts`）、`tests/add_car.test.ts` 的操作部分（建车模板留给 beta.4）、`ledger.test.ts` 里同步和互转的用例。
- [x] `tests/widget_imports.test.ts`：重模块列表加上 `app/*`，去掉 `sync/xxyh/sync.ts` 的特殊处理。

### 文档

- [x] `CLAUDE.md`：Project（不再同步）、Commands（`tools/migrate_v2.ts` 的用法）、On-device checks（`migrated`、去掉标志迁移和「real 小熊 sync」）、Layering（`app/`）、Benefits（`expense_id`、门店字段）、保养按 id 配对、Vehicles（去掉本机和小熊互转）、Backup and restore（v2）、「小熊 sync invariants」整节改成「小熊导入导出」：导出只在用户确认后、整份上传前检查、只改油记管的那几辆车、测试不能上传。
- [x] 主设计文档第 7、17 节只留一句指向 2.0 设计；§5、§12–§14、§18.3、§20.4、§21.4、§22 里说同步的地方改掉。
- [x] `docs/specs/2026-10-23-xxyh-mapping.md` 改成「导入和导出」（第 5、9、10 节）；`docs/specs/2026-10-23-benefits-wallet.md` 的 `expense_ts`、门店写在备注里的说法（第 3、4 节）。
- [x] `README.md`：开头的功能、「连接小熊油耗」改成导入导出、数据文件列表、油站搜索；`script.json` 的描述。
- [x] `CHANGELOG.md`：2.0.0-beta.2，写明切换步骤（先备份、恢复转换好的备份）。

### 切换（在用户手机上）

- [x] 用户关掉自动上传、做备份 → 电脑上转换，看报告，不要的记录在转换结果里删掉 → FuelNote Check 跑 `migrated`，看截图 → 用户装 beta.2，打开看到旧数据说明页，恢复 `backup-v2.json` → 按下面的验收项核对。切换当天再备份、重转一次。

## 2.0.0-beta.3：zip 备份和自动备份

设计第 6 节。

原则（用户 2026-10-24）：以功能为先，数据跟着功能调整，不为旧数据写功能。按这条审查后先做的清理（CHANGELOG 在发 beta.3 时写）：

- [x] 去掉按备注认店名：`common/stores.ts` 只看 `store_id`（去掉 `remarkStore`、`storeInRemark`、`remarkStoreId`），选择门店不列「来自费用备注」，记费用的默认门店、打开费用、费用列表第二行都只看字段。
- [x] 用户切换完，去掉 1.x 的一切：旧数据说明页、读 1.x 文件、恢复前另存 1.x 原文件、转换脚本和它的测试、FuelNote Check 的 `migrated`；还有打开时删旧缓存、读账本时清理旧设置项、「导出记录」文件的提示、`isLegacyLedger`。
- [x] 权益卡的门店改成 `store_id`（原计划 2.1）：门店改名卡跟着变，删门店卡也去掉门店；去掉按店名临时拼门店；`Store` 去掉 `source`。
- [x] `PerkUse` 不存抵扣，按 `deductOf` 算；去掉「没有对应的费用」的使用记录和保单详情的「没有对应的费用记录 / 重新记一笔」（2.0 里造不出这两种状态）。
- [x] 保险费用的备注只在新记时写，去掉 `GENERATED_REMARK`；报案电话只用保单上读到的，去掉按保险公司的兜底。
- [x] `dismissed_renewals` 必填，去掉 2.0 已保证的列表上的 `?? []`；编辑费用时备注没改就用原值。
- [x] FuelNote Check 的权益测试数据改成卡的格式；`split` 的期望值按关联算。

- [ ] 先在 Scripting 文档和 `dts/global.d.ts` 核对 `Archive` 的用法（打开、按条目写入、只读一个条目、`extractTo` 的越界保护）和 iCloud 文件的下载状态（`isFileStoredIniCloud`、`isiCloudFileDownloaded`）；文档没写清的，用 FuelNote Check 在手机上试，不猜。
- [ ] `common/backup_plan.ts`（新，纯）：`shouldAutoBackup(last, ledgerHash, now)`（超过一天且有变化；`ledgerHash` 不算 `current_vehicle_id`、`dismissed_*`）、`rotation(files, keep = 10)`（按文件名里的时间排，返回要删的；占位文件按名字认）、`backupName(now, kind)`（「油记备份-…」「恢复前-…」）。
- [ ] `app/backup.ts`：
  - `writeBackupZip(dest, { withSecrets })`：先在临时目录写 `backup.json` 和 `insurance/`，用 `Archive` 打包，读回 `backup.json` 校验，再移到目标位置。
  - `autoBackup()`：位置按设计第 6 节（iCloud 云盘 `油记备份/`，跟着数据根目录；没开 iCloud 时写文稿目录）；`BackgroundKeeper.keepAlive`；成功后才按 `rotation` 删旧的。FuelNote Check 的数据根目录下不运行。
  - `readBackupZip(path)`：只读出 `backup.json` 做预览；恢复时解出 `insurance/`，整个替换；列出找不到原件的保单。只认 zip。
  - 关闭主界面前等正在写的自动备份结束（最多 20 秒），代替原来等同步。
- [ ] `pages/app.tsx`：打开和回到前台时调用 `autoBackup()`（快捷指令入口不调）。
- [ ] `pages/backup_settings.tsx`：「自动备份」开关和「上次 <时间> · iCloud 云盘」；没开 iCloud 时标橙；「备份到文件」写 zip；恢复只选 zip；写明不加密的内容和高级数据保护的建议。
- [ ] FuelNote Check：`/run/ledger` 里做一次 zip 往返（数据和原件都一样）；确认 Check 不写 iCloud 的 `油记备份/`。
- [ ] 测试：`tests/backup_plan.test.ts`（间隔、只改界面状态不备份、保留 10 份、名字排序）；`tests/backup.test.ts` 加 zip 内容的纯函数部分（条目列表、原件份数统计）。
- [ ] `CHANGELOG.md`、`README.md`（备份一节）、`CLAUDE.md`（Backup and restore）。

## 2.0.0-beta.4：导出到小熊

设计第 7 节。

- [ ] `sync/xxyh/export.ts`（新，纯）：
  - `buildExport(cloud, ledger, state, now): { doc, diff, problems }`：按设计第 7 节第 2 步生成；字段比较用导入同一套映射（`recordsFromCar` 的逆向，`patchXxyhFuel`、`patchXxyhExpense`、新加 `patchXxyhMaintain`），备注、保养项目先按导入规则拆开再比；费用备注末尾按 `usageLine` 和门店生成；新记录照 `newXxyhCar`、`nextWc`、`carIdOf` 补字段。
  - `validateExport(cloud, doc, ledger)`：把 1.x `validateUpload` 的检查逐条搬过来（`tools/legacy_v1/` 没建，代码从 git 历史 c68a085 的 `sync/xxyh/ops.ts` 取），加上记录条数、`wc_id`、油站引用、两辆车指向同一辆小熊车。
  - `exportDiff(lastSnapshot, ledger)`：离线算「M 条修改没导出」。
- [ ] `app/xxyh_io.ts`：`exportToXxyh()`：下载 → 核对账号 → `buildExport` → 预览 → 确认 → 上传（`keepAlive`）→ 存快照、更新 `last_version`、`last_export_ts`。上传没收到回应时，先读一次最新版本比对。
- [ ] `pages/xxyh_export.tsx`（新）：预览每辆车的新增、修改、删除；云端在上次之后变过时标橙；换了导出目标时写明替换几条；「导出到小熊油耗」按钮（`Dialog` 再确认一次）。`pages/xxyh_settings.tsx` 加入口和「上次导出 N 天前 · M 条修改没导出」。
- [ ] FuelNote Check：新增 `/run/export`：在沙盒里用电脑发来的小熊备份导入、改几条、生成导出内容传回电脑，不上传；`tools/device_check.ts` 的 `export` 一项和云端原文逐字段比较。
- [ ] 测试：
  - `tests/fixtures/xxyh_synthetic.json`（合成）：充电、收入、提醒、未知字段、同一时刻、小数毫秒、结尾换行、带和不带结尾逗号的保养项目、百度坐标油站。
  - `tests/export.test.ts`：导入后直接导出，和原文逐字段相同；改、删、新增各一条后只有这几条变化；`validateExport` 认出每一种不允许的改动；账号不同时停下；两辆车指向同一辆小熊车时不通过；`exportDiff` 的条数。
  - `tests/real_data.test.ts`（`XXYH_ROOT`）：真实备份导入后直接导出，逐字段相同。
  - 所有测试照旧用 `readOnlyHttp`，不能上传。
- [ ] 第一次真正导出前问用户；导出后请用户在小熊 App 或网页版里核对。
- [ ] `CHANGELOG.md`、`README.md`（导出到小熊）、映射文档（导出一节）。

## 2.0.0 发布前

- [ ] 删掉 `tools/legacy_v1/` 和 `tools/migrate_v2*.ts` 以外不再用的旧代码引用；转换脚本留到 2.0.0 发布、用户确认数据无误后，在 2.1 开工时删掉。
- [ ] `CHANGELOG.md` 合成 2.0.0 一节；按 `CLAUDE.md` 的发布流程，用户说「发版」后再推送。

## 手机上的验收（2.0）

172. 2.0.0-beta.1：设置里没有了车况的「诊断请求方式」、「导出记录」；油站搜索只有一个开关，打开时记加油照常搜出附近的油站。
173. 删除一辆本机车辆：确认框写明一起删除的记录、保险、权益条数；删除后保险页、权益页里都没有这辆车的内容。
174. 装上 2.0.0-beta.1 隔天，「设置 › 版本」仍是 2.0.0-beta.1。
175. 2.0.0-beta.2：打开时看到旧数据说明页；恢复转换好的备份后，油耗、费用、保险、权益四页的条数、合计和 1.7 一样（与转换报告对照）。
176. 保险详情里每一年的保费都对应到费用；权益详情里每条「用于记费用」都能跳到那笔费用；费用列表第二行的门店和 1.7 一样，备注里不再有「抵扣 · 门店」那一行。
177. 改一笔导入的费用的日期，它的权益使用仍然连着；删这笔费用，权益剩余恢复。
178. 设置 › 小熊油耗：没有「自动上传」「立即同步」；「小熊里还没导入的车」照实列出；车辆编辑里「导出到小熊的车」选得到原来那辆。
179. 记加油、记费用、记保险、添加权益各做一次，小组件照常更新；下拉刷新只在油耗页。
180. 2.0.0-beta.3：设置 › 备份显示「自动备份 · 上次 …」；第二天打开后 iCloud 云盘「油记备份」里多一份 zip，里面有 `backup.json` 和保单原件。
181. 用这份 zip 恢复一次：数据和保单原件都在；恢复前那份也在。
182. 2.0.0-beta.4：导出预览的条数合理（只改过的几条算修改）；确认导出后，小熊 App 或网页版里加油、费用、保养和导出前一致，改过的那几条已更新，备注图片还在。
183. 回归：识别、记账、油耗与费用、权益四项自动检查全部通过；快捷指令截屏记加油照常。

自动检查和截图能覆盖 175–176 的条数和对应、179 的显示、181 的数据、183；仍要用户在手机上看的：172–174、177、178、180 的 iCloud 文件、182 的小熊 App。
