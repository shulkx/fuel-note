# 油记 1.6：油耗与费用分开 — 实施文档

- 设计：`docs/specs/2026-10-18-fuelnote-design.md` 第 21 节；界面草稿在画布「第四轮：油耗、费用、权益分成三个标签」（用户 2026-10-22 选定）。
- 目标：标签改为 油耗 · 费用 · 设置；油耗和费用各有自己的「记录 | 统计」，互不读对方的记录；保障页并入费用；小熊的保养只算一次；小组件的花费只算加油。没有新的数据，账本格式不变。
- 之后：1.7 权益（「权益」标签、大模型识别赠送和套餐），1.8 记保养，1.9 大模型识别其他格式的保单。见 `docs/plans/2026-10-21-insurance-benefits.md`。
- 约定沿用 `CLAUDE.md`：纯逻辑放 `common/`；入口只从一个模块导入；泛型箭头函数写成函数声明；frame 不混写；可选属性不传 `undefined`。

## 状态（2026-10-22）

- 1.6.0-beta.1 已实现。手机上的自动检查全部通过：识别 21 个文件一致，记账 39 项，油耗与费用 40 项（关联小熊的车上导入 6 年保单；油耗今年、全部的次数、油费、里程、平均油耗与电脑一致；7 条保养都和费用合成一行；保险以外各类别、保险的合计一致；有保养的月份只算一次；`widget.json` 只算加油）。看过两个标签记录、统计的截图（浅色、深色）。
- 第一次截图发现：分段控件放在导航栏中间时，大标题模式下副标题出现两次（控件下面一行、大标题下面一行），改为 inline 标题栏（设计 21.2 节）。导航栏上的玻璃按钮和分段控件在截图里显示成白字（1.5 的截图里车辆、「+」也是这样），要在手机上看实际样子。
- 等用户在手机上看剩下的项目（见「手机上的验收」最后一段）。

## 验证命令

```sh
npm run check                              # 类型检查
npm test                                   # 合成数据
XXYH_ROOT=E:/GitHub/xxyh npm test          # 另外核对小熊备份（只读）
XXYH_ROOT=E:/GitHub/xxyh npm run device-check   # 手机上的自动检查（FuelNote Check 开着）
```

交给手机验收时按 `CLAUDE.md`「Versions」发测试版：先写 CHANGELOG → `npm run bump -- 1.6.0-beta.n` → `npm run check` 和 `XXYH_ROOT=E:/GitHub/xxyh npm test` 都退出 0 再提交 → `git tag -s`，不推送。

## 1.6.0-beta.1

### 统计：纯函数分开

- [x] `common/ranges.ts`：从 `stats.ts` 移出 `StatsRange`、`RANGE_TITLES`、`RANGES`、`DEFAULT_RANGE`、`isStatsRange`、`rangeStart`，两边共用。
- [x] `common/fuel_stats.ts`（`stats.ts` 改名）：所有函数只收 `FuelRecord[]`。
  - `summarize`：去掉 `other_cost`、`total_cost`；`cost_per_km` 只算加油；里程只用加油记录。
  - `monthlyFuel`（原 `monthlyCosts`）：`{ month, cost, fills }`。
  - `yearSummaries`：`cost` 只算加油。
  - `monthFuelCost`（原 `monthCost`），给小组件。
- [x] `common/expense_stats.ts`（纯）：
  - `ExpenseEntry = { id, ts, amount, category_id, expense, maintenance }`。
  - `expenseEntries(records)`：费用和保养合成一笔一行。保养记录与同一时刻（`ts` 相同）的费用合成一行，金额取费用的；没有对应费用的保养，按保养的花费、类别「维修保养」（100001）算；加油记录不进来。
  - `expenseSummary(entries, range, now)`：`{ total, categories: [{ category_id, amount }]（按金额从大到小）, from_ts, count }`。
  - `expenseYears(entries)`：`[{ year, total, categories }]`，按付款日期，新的在前。
  - `monthTotals(entries)`：记录页每个月的合计。
- [x] `tests/fuel_stats.test.ts`：从 `core.test.ts` 移过来的三项（里程跨度、范围、日均和每年）改成只给加油记录；每公里油费不含费用。
- [x] `tests/expense_stats.test.ts`：合成记录——保养和同一时刻的费用合成一行、金额不重复；没有对应费用的保养照算；加油不进来；分类合计和排序；范围；每年按付款日期。
- [x] `tests/real_data.test.ts`：v307 的 7 条保养都和费用对上；合成后维修保养合计等于费用里维修保养的合计（不再多出保养的花费）。

### 模型和小组件

- [x] `common/model.ts`：
  - 改为从 `fuel_stats`、`expense_stats`、`ranges` 再导出；
  - 费用统计的范围单独记住（`fuelnote.expense_stats_range`，默认「全部」）；
  - `syncStatusText(data)`：副标题里的同步状态，不带小熊版本号（「刚刚同步」「2 条待上传」「同步失败」「只在本机」）；
  - `saveWidgetSnapshot` 的 `month_cost`、`year_cost` 只算加油。
- [x] `widget.tsx`：两格改为「本月油费」「今年油费」。

### 页面

- [x] `pages/components.tsx`：`ViewPicker`（「记录 | 统计」分段控件，放在 `toolbar.principal`）；`RecordRow` 拆开，加油行移到 `fuel_records.tsx`，费用行、保养行移到 `expense_records.tsx`。
- [x] `pages/fuel_tab.tsx`：`NavigationStack`，按 `ViewPicker` 显示 `FuelRecords` 或 `FuelStats`；左上角车辆菜单，右上角「+」直接记加油。
- [x] `pages/fuel_records.tsx`（由 `records.tsx` 改）：「当前」车况、加油停车提示、加油记录（按月，月合计只算加油）；去掉续保提醒、保险行、费用行。
- [x] `pages/fuel_stats.tsx`（由 `stats.tsx` 改）：8 个数字按设计 21.3 节；「每月花费」改为「每月加油」；「每年」的「花费」改为「油费」。
- [x] `pages/expense_tab.tsx`：同上，「+」轻点记费用、长按选记费用或记保险。
- [x] `pages/expense_records.tsx`：当前保单（从 `coverage.tsx` 移来，放进 `insurance_parts.tsx`）、续保提醒、费用记录（`expenseEntries` 按月，月合计 `monthTotals`）；保险行点开保单详情；合成的保养行点开是只读说明，不能左滑删除。
- [x] `pages/expense_stats.tsx`：范围；合计和分类（横条、金额、占比）；每年（按分类分段的横条）；保险（历年保险、缺的年份、只有金额，从 `coverage.tsx` 移来）。
- [x] `pages/app.tsx`：标签 油耗 · 费用 · 设置（`TAB_FUEL = 0`、`TAB_EXPENSE = 1`、`TAB_SETTINGS = 2`）；删除 `records.tsx`、`stats.tsx`、`coverage.tsx`。
- [x] `tests/boundary.test.ts`：油耗的文件（`common/fuel*.ts`、`pages/fuel_*.tsx`）不导入费用、保险的文件，从 `common/model` 导入的名字不在 `expense_stats.ts`、`insurance.ts` 的导出里；费用、保险的文件（`common/expense*.ts`、`pages/expense_*.tsx`、`pages/insurance_*.tsx`）同样不导入油耗的。

### 手机上的自动检查

- [x] `tools/check/runner.tsx`：
  - `/run/split`：电脑发来小熊备份和每年的保单计划。在检查用的文件夹里建一辆关联小熊的车，`xxyh.json` 的 base 就是这份备份；这辆车不同步、不上传。按 1.5 的做法导入每年的保单，补到备份里已有的保险费用。
  - 核对：加油、费用两边的合计与电脑算的一致；保养合成后没有重复；`widget.json` 只算加油。
  - 截图：`fuel-records`、`fuel-stats`、`expense-records`、`expense-stats`；原来的 `coverage`、`records` 换成 `expense-records`（续保提醒那辆车）。
- [x] `tools/device_check.ts`：`split` 一项——读最新的小熊备份，用同一套纯函数算出期望值，发给手机比较；截图加上新的四页。
- [x] `tools/check/README.md`：写明 `split`。

### 文档和发布

- [x] `CLAUDE.md`（标签、「当前」一组的位置、路线图）、`README.md`、`CHANGELOG.md`。
- [x] `docs/plans/2026-10-21-insurance-benefits.md`：分期改为 1.7 权益、1.8 记保养、1.9 大模型识别保单，手机验收的编号接着这里往后排。
- [x] 发测试版 1.6.0-beta.1；先跑手机上的自动检查，看完全部截图，再请用户看剩下的项目。

## 手机上的验收（1.6）

143. 标签栏：油耗 · 费用 · 设置，打开时在油耗。
144. 油耗 › 记录：只有加油记录，月合计只算加油；「当前」车况、加油停车提示照旧；「+」轻点直接打开记加油；左滑删除、下拉同步照旧。
145. 导航栏中间切换「记录 | 统计」。油耗 › 统计：范围、8 个数字（每公里油费不含费用）、每月加油、同期对比、单价、每年，数字与电脑上用同一份备份算的一致。
146. 费用 › 记录：当前保单在最上面，徽章、报案、保单原件照旧；快到期时下面有续保提醒；保险行点开是保单详情；保养只有一行，月合计不重复；「+」轻点记费用，长按可以记保险。
147. 费用 › 统计：合计和分类、每年（按付款日期）、保险（历年保险、缺的年份、只有金额、补充保单），数字与电脑算的一致。
148. 小组件：「本月油费」「今年油费」只算加油。
149. 切换车辆后两个标签都跟着变；深色模式下都看得清。
150. 1.5 回归：识别、记账两项自动检查照常全部通过；保单详情、记保险表单照旧。

自动检查和截图能覆盖 144–147 的显示和数字、148 的 `widget.json`、149 的深色、150；仍要用户在手机上看的：标签栏、导航栏中间的切换（真实点按）、「+」的轻点和长按、左滑和下拉、桌面上的小组件、切换车辆。
