# 油记 2.0：以油记为准 — 实施文档

- 设计：`docs/specs/2026-10-24-local-first.md`（用户 2026-10-24 确认）。后续：2.1 记保养与沃尔沃养修（`docs/specs/2026-10-24-maintenance-volvo.md`），2.2 大模型识别保单。
- 目标：数据全部存在本机，记录有固定的 id，关联和门店改成字段；小熊只做导入和手动导出；现有数据在电脑上转换一次；备份改成 zip 并自动备份到 iCloud 云盘；顺带删掉诊断、旧迁移等不再需要的代码，拆开 `model.ts`。
- 约定沿用 `CLAUDE.md`：纯逻辑放 `common/`、`sync/`、`stations/`、`readers/`；入口只从一个模块导入，单行 `export { … } from` 不加结尾逗号；泛型写成函数声明或 `<T,>`；frame 不混写；可选属性不传 `undefined`；数据文件都经过 `writeAtomic`。
- 每个测试版：先写 CHANGELOG → `npm run bump -- x.y.z` → `npm run check` 和 `XXYH_ROOT=E:/GitHub/xxyh npm test` 都退出 0 才提交（不用 `;` 串起来）→ `git tag -s`，不推送 → 跑 FuelNote Check、看完截图 → 再请用户看剩下的项目。

## 状态（2026-10-24）

- 设计确认，实施文档写好，还没开工。
- 开工前：工作区里 2.1 要用的改动（`providers/volvo_cn.ts` 的 POST 签名和 `volvoGateway`、`tests/providers.test.ts`、`tools/volvo_service_probe.ts`、`docs/specs/2026-10-23-xxyh-mapping.md`）和这几份设计、实施文档，先单独提交，不混进 beta.1。

## 请用户配合的

1. 测试期间关掉「设置 › 小熊油耗 › 保存后自动上传」。
2. 现在在 1.7 里「备份到文件」（不含凭据），传到电脑放进 `E:\GitHub\xxyh\out\fuelnote\`，用来核对真实数据：没上传的修改、保险 id 的格式、备注最后一行的写法。
3. 装上 2.0.0-beta.1 后，隔天看一次「设置 › 版本」，确认每天的自动更新没有把测试版换回 1.7。
4. 切换到 beta.2 当天再备份一次，转换重跑一遍。

## 2.0.0-beta.1：和同步无关的删减和小修

数据格式不变，同步照旧。只删、只整理，不改账本结构。

### 删掉

- [ ] 车况诊断：`pages/provider_settings.tsx` 的原始字段显示和「诊断请求方式」（`runProbe`、`setProbe`、诊断结果）；`platform/scripting_http.ts` 的 `probeBinaryPost`；`common/model.ts` 的 `diagnoseVehicleStatus` 和再导出；`VehicleStatus.raw`（`providers/types.ts`、`providers/volvo_cn.ts` 里填它的地方）。
- [ ] 小组件诊断：`widget.tsx` 的 `Widget.parameter === "诊断"` 分支；`common/widget_runtime.ts`、`common/widget_refresh.ts` 里写 `widget_status_log.json` 的代码；`WidgetSnapshot.pending`（`common/widget_data.ts`）和 `model.ts` 里给它赋值的地方。
- [ ] 交强险标志的旧迁移：`common/model.ts` 的 `upgradeInsuranceMarks`、`common/insurance.ts` 只给它用的函数、`Settings.insurance_marks_checked`、`pages/app.tsx` 启动时的调用、`tools/check/runner.tsx` 里的那一步。读账本时去掉这个设置项。
- [ ] 「导出记录」：`common/model.ts` 的 `exportData` 和设置里的入口；`platform/storage.ts` 的 `writeExport` 不再有人用就删掉。
- [ ] 死代码和过时注释：
  - `pages/fuel_form.tsx`、`pages/app.tsx` 里 `initialImage` 按字符串路径的分支（`intent.tsx` 总是传 `UIImage`）；
  - `pages/benefit_form.tsx` 的测试入口 `scanned`（FuelNote Check 改用别的办法，见下）；
  - `common/receipt.ts` 里说识别会换一种方式再试的注释；
  - `common/model.ts`、`common/ledger.ts` 里重复的文档注释；`model.ts` 文件头（还写着小组件从它导入）；
  - `CLAUDE.md` 里 `initialImagePath` 的说法改成 `UIImage`。

### 改

- [ ] 油站搜索改成开关：`pages/station_search_settings.tsx` 只有「搜索附近的油站」开关和说明（开：有高德 Key 用高德，否则用小熊；关：只用我的油站）。存的值只写 `"auto"`、`"off"`；读到 `"amap"`、`"xxyh"` 当作 `"auto"`（`platform/storage.ts` 补字段的地方）。`model.ts` 的 `rawSearcher` 跟着简化。
- [ ] 删除车辆连带删除（本机车辆；小熊车辆在 beta.2 才能删）：`common/model.ts` 的 `deleteVehicle` 一起删这辆车的保险年度（`removePolicyFiles`）、权益卡、使用记录；纯函数部分放进 `common/ledger.ts`（`vehicleDeletion(ledger, id)` 返回删掉后的账本和各类条数）。`pages/vehicle_edit.tsx` 的确认框写明「同时删除 N 条记录、N 年保险（含保单原件）、N 项权益」。
- [ ] `common/format.ts`：`money`（带千分位、两位小数）、`moneyShort`、`bjDay`（北京时间的日期）、`monthKey`、`fileStamp`（备份文件名里的时间），替换 `pages/components.tsx`、`common/perks.ts`、`pages/insurance_parts.tsx`、`common/insurance.ts`、`common/policy_text.ts`、`common/draft.ts`、`common/time.ts`、`common/ranges.ts`、`common/model.ts`、`pages/insurance_form.tsx`、`pages/benefit_form.tsx` 里各自的副本。`common/widget_data.ts` 不引用别的源文件，它的副本保留。
- [ ] 存储层可测：
  - `common/files.ts`（纯）：`type Fs = { exists; readText; writeText; rename; copy; remove; list; mkdir }`，`writeAtomic(fs, path, text)`、`readJson(fs, path, fallback, valid)`、坏文件和恢复前副本只留最近 5 份（`pruneCopies`）。
  - `platform/storage.ts` 用 Scripting 的 `FileManager` 实现 `Fs`，原有的函数签名不变。
  - 缓存（`catalog_cache.json`、`poi_cache.json`、`trips_cache.json`、`status_cache.json`）移到 `FuelNote/cache/`；旧位置的缓存直接删掉（都能重新读）。小组件读 `status_cache.json` 的路径一起改。
- [ ] FuelNote Check：`runner.tsx` 去掉标志迁移那一步；`STAMP` 加一；权益识别改成电脑直接发识别结果给表单的纯函数核对，不再经过 `scanned`。

### 测试

- [ ] `tests/storage.test.ts`（新）：内存里的 `Fs`；`writeAtomic` 中途失败时原文件还在；坏文件另存后用默认值；副本只留 5 份；缓存写在 `cache/`，旧位置的被删掉。
- [ ] `tests/pure_layer.test.ts`（新）：`common/`（除 `model.ts`、`widget_data.ts`、`widget_runtime.ts`、`widget_refresh.ts`）、`sync/`、`stations/`、`readers/`、`providers/` 的源文件不导入 `"scripting"`，也不用 `FileManager`、`Keychain`、`Dialog` 等全局对象。
- [ ] `tests/vehicles.test.ts`：`vehicleDeletion` 删掉记录、保险年度、卡、使用记录，其他车的不动；条数对。
- [ ] `tests/core.test.ts` 或新的 `tests/format.test.ts`：`money` 等的输出和原来各处一致（负数、0、大数、两位小数）。
- [ ] 删掉 `upgradeInsuranceMarks`、诊断相关的测试；`tests/widget_imports.test.ts` 照旧通过。

### 文档和发布

- [ ] `CHANGELOG.md`：2.0.0-beta.1（去掉诊断、导出记录、油站搜索改成开关、删车连带删除）。
- [ ] `CLAUDE.md`：版本一节的路线图改成 2.0 以油记为准、2.1 记保养、2.2 大模型识别保单；必读文档加上 2.0、2.1 设计和本文。
- [ ] `docs/plans/2026-10-21-insurance-benefits.md`：1.8、1.9 两节各留一句，分别指向 2.1 设计和 2.2。

## 2.0.0-beta.2：以油记为准

设计第 3–5、8、9 节。先冻结旧代码、写转换脚本并用真实备份反复跑，再删同步。

### 冻结 1.7 的代码，写转换脚本

- [ ] `tools/legacy_v1/`：从当前代码复制转换要用的部分，只改导入路径，不改逻辑：`types.ts`（1.x 的账本、小熊状态、记录类型）、`ops.ts`（`applyOps`）、`mapping.ts`（`mapBackup`、`xxyhRecordId`、`parseXxyhRecordId`）、`mirror.ts`（`computeMirror`、`linkInsuranceExpenses`、`maintenanceExpenses`）、`remark.ts`（`splitRemark`、`usageLine`、`remarkStore`）、`backup.ts`（1.x 的 `parseBackup`）。文件头写明「冻结的 1.7 代码，只给 migrate_v2 用，不进发布包」。
- [ ] `tsconfig.json` 的 include 加上 `tools/**/*.ts`（`tools/check`、`tools/probe` 是 Scripting 代码，按现有方式排除或单独处理，保证 `npm run check` 通过）。
- [ ] `tools/migrate_v2.ts`：`XXYH_ROOT=… npx tsx tools/migrate_v2.ts <1.x 备份> [--stores <白名单>]`。纯函数 `migrateV1(backup, whitelist): { ledger: LedgerFileV2; xxyh: XxyhStateV2; snapshot; report }` 放在同目录的 `migrate_v2_core.ts`，测试直接调它。规则照设计第 5 节第 2 步：
  - 用 `computeMirror` 得到每辆小熊车显示的记录（含没上传的修改；冲突的记进报告）；
  - 生成新 id、带 `xxyh_raw`（取 `applyOps` 之后的那份原样）；保养存成 `MaintenanceRecord`，按同一时刻配好 `expense_id`；
  - 小熊记录以外的 id 不变；权益使用按 `expense_ts` 找费用（恰好一笔才写，否则记进报告）；保险年度的 `x:` id 用 `parseXxyhRecordId` 找到记录换成新 id；
  - 门店拆分：最后一行等于按这笔费用的使用记录生成的 `usageLine`，或等于已有门店名，或在白名单里；关联了保险的费用不拆；权益卡的店名找到或新建门店；
  - 费用类别以小熊 `expenseTypes`（`sortId`）为准，补本机独有的；油站全部复制；车型资料复制到 `profile`；
  - 小熊状态：`account_id`、`nickname`、`last_version = base_version`，base 作为快照；
  - 检查：每辆车每种记录条数相同、`ledgerProblems` 为空，不通过就不写文件。
  - 输出到 `XXYH_ROOT/out/fuelnote/`：`backup-v2.json`（2.0 的 `backup.json`）、`report.md`（不进仓库）。屏幕只打印条数和报告路径，不打印备注、金额、门店名。
- [ ] `tests/fixtures/v17_backup.json`（合成，不含真实数据）：一辆关联小熊的车（含没上传的修改，其中一条冲突）、一辆本机车、一辆隐藏的车、带 `#n` 的保险 id、只有金额的车险、各种备注最后一行（权益用量 + 门店、只有门店、像店名但不是的、用户自己写的）、同一时刻的保养和费用、小数毫秒、以换行结尾的备注。
- [ ] `tests/migrate_v2.test.ts`：条数相同；`ledgerProblems` 为空；使用记录、保险年度都换成新 id；门店只按规则拆，白名单生效，保险费用不拆；本机记录 id 不变；没上传的修改带上、冲突的进报告；`xxyh_raw` 保留小数毫秒和结尾换行；重复运行结果相同。`XXYH_ROOT` 下有用户的 1.7 备份时，再跑一遍并检查同样的不变量。

### 数据格式和读写

- [ ] `common/types.ts`：照设计第 3 节改成 2.0 的类型（`LedgerFile.schema_version: 2`、必填数组、`LocalRecord` 含保养、`store_id`、`expense_id`、`xxyh_raw`、去掉 `origin`/`pending`/`xxyh_ignored_cars`/`xxyh_auto_upload`/`former_xxyh_car`）。`sync/xxyh/types.ts`：`XxyhState` 改成 v2，删掉 `XxyhOp`。
- [ ] `common/ledger_file.ts`（新，纯）：`normalizeLedger(raw)`（补字段、`station_search` 旧值、保留不认识的字段）、`ledgerProblems(ledger)`（所有引用）、`isLegacyLedger(raw)`。
- [ ] `common/files.ts` / `platform/storage.ts`：账本、小熊状态写 `ledger2.json`、`xxyh2.json`；只读到 1.x 的 `ledger.json` 时返回 `{ legacy: true }`，不另存坏文件、不写任何文件。
- [ ] `common/ledger.ts` 重写：
  - `AppData = { ledger, xxyh }`，去掉 `Mirror`、`computeMirror`、`pendingCount`、`isLinked`、`parseXxyhRecordId` 的使用；`vehicleRecords`、`stationsFor`、`categoriesFor` 只读账本。
  - `putFuel`、`putExpense`：编辑时合并原记录的 `xxyh_raw`、`store_id`（表单没改门店时）、保养的 `expense_id`。
  - `removeRecord`：删费用时删掉它的使用记录、清空指向它的保险年度和保养的 `expense_id`；删保养记录时不删费用（2.1 再做保养行一起删）。
  - 保险：`putInsurance` 直接更新 `expense_id` 指向的费用；删掉保存后的 `linkInsuranceExpenses`、`GENERATED_REMARK`。`pages/insurance_form.tsx` 的「补到已有的费用」「保留原金额 / 改成保单合计」照旧（候选费用按 id），测试覆盖：导入的数据上记一年保险，补到那笔已有的费用，费用统计里只算一次。
  - `vehicleDeletion` 对所有车生效（`model.ts` 去掉「小熊车辆不能删」）。
  - 删掉 `convertToXxyh`、`convertToLocal`、`materialize`、`materializeAll`、`vehiclesForCars`、`newCars`、`setCarIgnored`、`carUuidFor`、`deletedCars`、`convertDeletedCars`、`rebaseSync`、`deletedCarsNotice`。
- [ ] `common/perks.ts`、`common/perk_ledger.ts`：使用记录按 `expense_id`；`expenseUses`、`usedOf`、`usablePerks` 跟着改；`splitRemark`、`joinRemark`、`usageLine` 不再用于存取，`usageLine` 留给导出（beta.4）。
- [ ] `common/stores.ts`：门店按 id；`storeCandidates` 只列 `ledger.stores`；`remarkStore` 只在「没有 `store_id` 的旧费用显示备注最后一行」时用。
- [ ] `common/expense_stats.ts`：`maintenanceExpenses` 按 `expense_id` 配对。
- [ ] `common/insurance.ts`：`isCarInsurance` 先看 `expense_id`；只有金额的车险规则照旧。

### 导入

- [ ] `sync/xxyh/import.ts`（新，纯）：`importCars(backup, uuids, ledger, now)`：选中的车导入成油记车辆和记录（新 id、`xxyh_raw`、保养配好 `expense_id`、不拆门店），油站全部复制、类别补齐、`profile` 从车型资料复制；返回新账本和每辆车的条数。规则和 `migrate_v2_core.ts` 里的记录部分共用一个函数（`recordsFromCar`），放在 `sync/xxyh/import.ts`，转换脚本从这里导入。
- [ ] `sync/xxyh/sync.ts` 只剩 `download(http, token)`（账号信息 + 最新版本）和 `upload`（beta.4 用）；删掉 `pull`、`push`。`sync/xxyh/ops.ts` 删掉（已复制到 `tools/legacy_v1/`）。
- [ ] `mapping.ts`：删掉 `xxyhRecordId`、`parseXxyhRecordId`、`idFor`；`mapBackup` 改成 `recordsFromCar` 用的映射；`patchXxyhFuel`、`patchXxyhExpense` 留给 beta.4。

### `app/` 和 `model.ts`

- [ ] 新建 `app/`（Scripting 代码，可以用全局对象）：`store.ts`（读写账本、提交、`DataRef`）、`policy_files.ts`、`xxyh_io.ts`（连接、导入、没导入的车）、`vehicle_data.ts`（车况、行程、停车、车型库缓存）、`stations.ts`、`recognize.ts`、`backup.ts`、`widget_snapshot.ts`、`prefs.ts`（设置、点过「×」的提醒）。`app/*` 互相可以导入，不导入 `common/model.ts`。
- [ ] `common/model.ts` 只做转出（单行 `export { … } from`，不加结尾逗号）；页面照旧只从它导入。
- [ ] `app/` 加进 `.github/workflows/release.yml` 的「Prepare package」、`tools/install_check.mjs` 的 `DIRS`、`tsconfig.json`；`tests/release.test.ts` 照旧通过。
- [ ] `tests/boundary.test.ts`：从 `common/model` 导入的名字按转出的来源检查；`tests/import_cycles.test.ts`（新）：从 `index.tsx` 出发没有循环导入，`app/*` 不导入 `common/model.ts`。
- [ ] 删掉 `syncXxyh`、`doSyncXxyh`、`autoSync`、`afterChange`、`waitForPendingSync`、`syncStatusText`、`pendingForVehicle`、`xxyhNewCars`、`xxyhIgnoredCars`、`addXxyhCar`、`setXxyhCarIgnored`、`convertVehicleToXxyh`、`convertVehicleToLocal`、`commitRelinked`、`upgradeInsuranceMarks`（beta.1 已删）；`commit` 只写一个文件。

### 页面

- [ ] `pages/app.tsx`：
  - 一个 `mutate(label, change)`：保存、刷新小组件、闪一下提示；替换现在 7 处「保存 → 提示 → 同步」；`requireVehicle()` 替换 3 处「还没有车辆」；读写统一叫 `DataRef`。
  - 权益相关的处理移到 `pages/benefit_actions.ts`；`storeByName`、`keptExpenses` 改成按 id。
  - 去掉 `applySync`、启动和回前台的 `autoSync`、`syncAll`、新车提示、「保养记录请在小熊油耗 App 中修改」；`runApp` 不再等同步。
  - 打开时 `legacy` 为真：只显示说明页（设计第 5 节第 6 步），有「恢复备份…」和「从小熊油耗导入…」两个按钮。
- [ ] `pages/components.tsx`：去掉 `PendingTag`、`AppActions.sync`。`fuel_records.tsx` 的下拉只刷新车况；`expense_records.tsx`、`insurance_tab.tsx`、`benefit_tab.tsx` 去掉下拉刷新和副标题里的同步状态。
- [ ] `pages/fuel_form.tsx`：选油站改用 `stationsFor`，不再自己判断小熊。
- [ ] `pages/expense_form.tsx`：门店存 `store_id`；备注只显示、保存用户写的内容；去掉「同步到小熊」的脚注。`pages/expense_records.tsx`：第二行的门店从 `store_id` 读，没有时照旧取备注最后一行。
- [ ] `pages/insurance_detail.tsx`、`pages/benefit_detail.tsx`：去掉「可能在小熊油耗里被删除了」「没有对应的费用」里说小熊的文字；只在 `expense_id` 找不到时显示「没有对应的费用」。
- [ ] 车辆：`pages/vehicle_add.tsx` 去掉「保存位置」；`pages/vehicle_edit.tsx` 去掉「转为小熊车辆 / 本机车辆」，加「导出到小熊的车」（列出小熊里的车和「不导出」；beta.4 之前只存不导出），删除对所有车开放；`pages/vehicle_menu.tsx` 不再分组。
- [ ] `pages/xxyh_settings.tsx` 重写：凭据；「从小熊油耗导入…」（勾选车辆）；「小熊里还没导入的车」；断开（只删凭据和小熊状态，不动数据）。
- [ ] `pages/settings.tsx`：「同步」一组改成「小熊油耗」，第二行写账号和「上次导入 / 导出」。
- [ ] `pages/backup_settings.tsx`：去掉「N 条修改还没上传 / 立即上传」「保留未上传的修改」、恢复后同步；摘要去掉「连接小熊油耗的车」「版本」。这一版备份仍是一个 JSON 文件，`backup.json` 的 `version` 2。

### 备份（JSON，2.0 格式）

- [ ] `common/backup.ts`：`BACKUP_VERSION = 2`；`BackupFile` 带 v2 的账本、v2 的小熊状态和精简快照（`cars`、`myStations`、`expenseTypes`）；`parseBackup` 只认 2，遇到 1 抛「这是 1.x 的备份，请先在电脑上转换」；删掉 `restoredXxyh`；摘要按 v2 统计。
- [ ] `app/backup.ts`：恢复经过 `normalizeLedger`，`ledgerProblems` 不为空时在预览里列出；恢复前副本（1.x 数据时复制 `ledger.json`、`xxyh.json` 原文件）；恢复后重写 `widget.json`。

### FuelNote Check

- [ ] `tools/check/runner.tsx`：`/run/split` 改用 `importCars` 建车（不再有 `xxyh.json` 的 base、不调 `applyOps`）；`/run/ledger` 去掉 `keepOps`；新增 `/run/migrated`：电脑发来 `backup-v2.json`，在沙盒里恢复，回报每辆车的条数、保险年度和费用的对应、权益使用和费用的对应、门店，截油耗、费用、保险、权益四页和一笔有门店的费用。`STAMP` 加一。
- [ ] `tools/device_check.ts`：去掉 `origin`、`pending`；`migrated` 一项读 `XXYH_ROOT/out/fuelnote/backup-v2.json`，用同一套纯函数算期望值；`split` 的期望值改用 `importCars`。
- [ ] `tools/check/README.md`：写明 `migrated`。

### 测试

- [ ] 改写：`tests/ledger.test.ts`（编辑合并 `xxyh_raw`/`store_id`/`expense_id`、删费用清关联、删车）、`insurance_ledger.test.ts`（按 id）、`perk_ledger.test.ts`（按 `expense_id`）、`backup.test.ts`（v2、拒绝 v1）、`expense_stats.test.ts`（保养按 id 配对）、`real_data.test.ts`（导入真实备份后条数、合计照旧）、`vehicles.test.ts`。
- [ ] 新增：`tests/import.test.ts`（合成小熊备份导入：条数、`xxyh_raw`、保养配对、油站、类别顺序）、`tests/ledger_file.test.ts`（`normalizeLedger` 保留不认识的字段、`ledgerProblems` 认出每种断开的引用、`isLegacyLedger`）。
- [ ] 删掉：`tests/xxyh_ops.test.ts` 的操作部分（凭据、映射、油站 id、类别排序的用例留下，移到 `tests/xxyh_mapping.test.ts`）、`tests/add_car.test.ts` 的操作部分（建车模板留给 beta.4）、`ledger.test.ts` 里同步和互转的用例。
- [ ] `tests/widget_imports.test.ts`：重模块列表加上 `app/*`，去掉 `sync/xxyh/sync.ts` 的特殊处理。

### 文档

- [ ] `CLAUDE.md`：Project（不再同步）、Commands（`tools/migrate_v2.ts` 的用法）、On-device checks（`migrated`、去掉标志迁移和「real 小熊 sync」）、Layering（`app/`）、Benefits（`expense_id`、门店字段）、保养按 id 配对、Vehicles（去掉本机和小熊互转）、Backup and restore（v2）、「小熊 sync invariants」整节改成「小熊导入导出」：导出只在用户确认后、整份上传前检查、只改油记管的那几辆车、测试不能上传。
- [ ] 主设计文档第 7、17 节只留一句指向 2.0 设计；§5、§12–§14、§18.3、§20.4、§21.4、§22 里说同步的地方改掉。
- [ ] `docs/specs/2026-10-23-xxyh-mapping.md` 改成「导入和导出」（第 5、9、10 节）；`docs/specs/2026-10-23-benefits-wallet.md` 的 `expense_ts`、门店写在备注里的说法（第 3、4 节）。
- [ ] `README.md`：开头的功能、「连接小熊油耗」改成导入导出、数据文件列表、油站搜索；`script.json` 的描述。
- [ ] `CHANGELOG.md`：2.0.0-beta.2，写明切换步骤（先备份、恢复转换好的备份）。

### 切换（在用户手机上）

- [ ] 用户关掉自动上传、做备份 → 电脑上转换，看报告，需要时补白名单 → FuelNote Check 跑 `migrated`，看截图 → 用户装 beta.2，打开看到旧数据说明页，恢复 `backup-v2.json` → 按下面的验收项核对。切换当天再备份、重转一次。

## 2.0.0-beta.3：zip 备份和自动备份

设计第 6 节。

- [ ] 先在 Scripting 文档和 `dts/global.d.ts` 核对 `Archive` 的用法（打开、按条目写入、只读一个条目、`extractTo` 的越界保护）和 iCloud 文件的下载状态（`isFileStoredIniCloud`、`isiCloudFileDownloaded`）；文档没写清的，用 FuelNote Check 在手机上试，不猜。
- [ ] `common/backup_plan.ts`（新，纯）：`shouldAutoBackup(last, ledgerHash, now)`（超过一天且有变化；`ledgerHash` 不算 `current_vehicle_id`、`dismissed_*`）、`rotation(files, keep = 10)`（按文件名里的时间排，返回要删的；占位文件按名字认）、`backupName(now, kind)`（「油记备份-…」「恢复前-…」）。
- [ ] `app/backup.ts`：
  - `writeBackupZip(dest, { withSecrets })`：先在临时目录写 `backup.json` 和 `insurance/`，用 `Archive` 打包，读回 `backup.json` 校验，再移到目标位置。
  - `autoBackup()`：位置按设计第 6 节（iCloud 云盘 `油记备份/`，跟着数据根目录；没开 iCloud 时写文稿目录）；`BackgroundKeeper.keepAlive`；成功后才按 `rotation` 删旧的。FuelNote Check 的数据根目录下不运行。
  - `readBackupZip(path)`：只读出 `backup.json` 做预览；恢复时解出 `insurance/`，整个替换；只有 `backup.json` 时保留现有原件；列出找不到原件的保单。
  - 关闭主界面前等正在写的自动备份结束（最多 20 秒），代替原来等同步。
- [ ] `pages/app.tsx`：打开和回到前台时调用 `autoBackup()`（快捷指令入口不调）。
- [ ] `pages/backup_settings.tsx`：「自动备份」开关和「上次 <时间> · iCloud 云盘」；没开 iCloud 时标橙；「备份到文件」写 zip；恢复选 zip 或 JSON；写明不加密的内容和高级数据保护的建议。
- [ ] FuelNote Check：`/run/ledger` 里做一次 zip 往返（数据和原件都一样）、只有 JSON 的恢复保留原件；确认 Check 不写 iCloud 的 `油记备份/`。
- [ ] 测试：`tests/backup_plan.test.ts`（间隔、只改界面状态不备份、保留 10 份、名字排序）；`tests/backup.test.ts` 加 zip 内容的纯函数部分（条目列表、原件份数统计）。
- [ ] `CHANGELOG.md`、`README.md`（备份一节）、`CLAUDE.md`（Backup and restore）。

## 2.0.0-beta.4：导出到小熊

设计第 7 节。

- [ ] `sync/xxyh/export.ts`（新，纯）：
  - `buildExport(cloud, ledger, state, now): { doc, diff, problems }`：按设计第 7 节第 2 步生成；字段比较用导入同一套映射（`recordsFromCar` 的逆向，`patchXxyhFuel`、`patchXxyhExpense`、新加 `patchXxyhMaintain`），备注、保养项目先按导入规则拆开再比；费用备注末尾按 `usageLine` 和门店生成；没填标号用车辆默认标号；新记录照 `newXxyhCar`、`nextWc`、`carIdOf` 补字段。
  - `validateExport(cloud, doc, ledger)`：把 `tools/legacy_v1/ops.ts` 里 `validateUpload` 的检查逐条搬过来，加上记录条数、`wc_id`、油站引用、两辆车指向同一辆小熊车。
  - `exportDiff(lastSnapshot, ledger)`：离线算「M 条修改没导出」。
- [ ] `app/xxyh_io.ts`：`exportToXxyh()`：下载 → 核对账号 → `buildExport` → 预览 → 确认 → 上传（`keepAlive`）→ 存快照、更新 `last_version`、`last_export_ts`。上传没收到回应时，先读一次最新版本比对。
- [ ] `pages/xxyh_export.tsx`（新）：预览每辆车的新增、修改、删除；云端在上次之后变过时标橙；换了导出目标时写明替换几条；「导出到小熊油耗」按钮（`Dialog` 再确认一次）。`pages/xxyh_settings.tsx` 加入口和「上次导出 N 天前 · M 条修改没导出」。
- [ ] FuelNote Check：新增 `/run/export`：在沙盒里用电脑发来的小熊备份导入、改几条、生成导出内容传回电脑，不上传；`tools/device_check.ts` 的 `export` 一项和云端原文逐字段比较。
- [ ] 测试：
  - `tests/fixtures/xxyh_synthetic.json`（合成）：充电、收入、提醒、未知字段、同一时刻、小数毫秒、结尾换行、带和不带结尾逗号的保养项目、百度坐标油站。
  - `tests/export.test.ts`：导入后直接导出，和原文逐字段相同；改、删、新增各一条后只有这几条变化；没填标号写默认标号；`validateExport` 认出每一种不允许的改动；账号不同时停下；两辆车指向同一辆小熊车时不通过；`exportDiff` 的条数。
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
