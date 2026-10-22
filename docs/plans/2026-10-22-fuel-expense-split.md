# 油记 1.6：油耗与费用分开 — 实施文档

- 设计：`docs/specs/2026-10-18-fuelnote-design.md` 第 21 节；界面草稿在画布「第四轮：油耗、费用、权益分成三个标签」（用户 2026-10-22 选定）。1.6.0-beta.4 起按第 22 节（每一页的权责），草稿在画布「第七轮 · 1.6：油耗 · 费用 · 保险 · 设置」。
- 目标：标签改为 油耗 · 费用 · 设置；油耗和费用各有自己的「记录 | 统计」，互不读对方的记录；保障页并入费用；小熊的保养只算一次；小组件的花费只算加油。没有新的数据，账本格式不变。
  - 1.6.0-beta.4：标签改为 油耗 · 费用 · 保险 · 设置；保险单独一页；费用页和费用统计只放车险以外；记费用顶部分段选类别。
- 之后：1.7 权益（第四个标签，设置移到第五个；大模型识别赠送和套餐、门店、记费用时使用权益），1.8 维修保养的里程和项目（记费用的维修保养模板，写进小熊的保养记录），1.9 大模型识别其他格式的保单。见 `docs/plans/2026-10-21-insurance-benefits.md`。
- 约定沿用 `CLAUDE.md`：纯逻辑放 `common/`；入口只从一个模块导入；泛型箭头函数写成函数声明；frame 不混写；可选属性不传 `undefined`。

## 状态（2026-10-22）

- 1.6.0-beta.1 已实现。手机上的自动检查全部通过：识别 21 个文件一致，记账 39 项，油耗与费用 40 项（关联小熊的车上导入 6 年保单；油耗今年、全部的次数、油费、里程、平均油耗与电脑一致；7 条保养都和费用合成一行；保险以外各类别、保险的合计一致；有保养的月份只算一次；`widget.json` 只算加油）。看过两个标签记录、统计的截图（浅色、深色）。
- 第一次截图发现：分段控件放在导航栏中间时，大标题模式下副标题出现两次（控件下面一行、大标题下面一行），改为 inline 标题栏（设计 21.2 节）。导航栏上的玻璃按钮和分段控件在截图里显示成白字（1.5 的截图里车辆、「+」也是这样），要在手机上看实际样子。
- 用户在手机上看了 1.6.0-beta.1（2026-10-22）：顶部的「记录 | 统计」太大；车辆名的副标题离它太近；费用统计的「每年」和「历年保险」重复。
- 1.6.0-beta.3 之后（2026-10-22）：FuelNote Check 里做了费用统计的四种设计预览（工作区里，没有提交）。用户提出保险单独一个标签；第六轮稿（油耗 · 保养 · 保险 · 设置）的保养页又太满。第七轮重新划分每一页的权责（设计第 22 节），用户确认方向，并决定费用统计不含保险（「保持单一规则」）、先不加通知。四种预览不再需要，在 1.6.0-beta.4 里删掉。

## 1.6.0-beta.2

- [x] `pages/components.tsx` 的 `ViewBar`：小号（`controlSize="small"`）的「记录 | 统计」固定在大标题和副标题下面（`safeAreaInset`，底色与列表相同；本地脚本 Epical 首页的日期条也是这样做的），不再放导航栏中间；四页恢复大标题。
- [x] `pages/expense_stats.tsx`：「每年」只算保险以外的费用，金额为 0 的年份不列；保险只在「历年保险」里。

用户在手机上看了 1.6.0-beta.2（2026-10-22）：下拉刷新时大标题穿过固定的「记录 | 统计」，它的灰色底色也不和谐。用户要求先给几种做法、在 FuelNote Check 里看实际效果再选。

## 1.6.0-beta.3

- [x] FuelNote Check 加了「记录 | 统计」的六种放法预览（和油记一样的两个标签，检查用的账本，可以切换、滚动、下拉）：列表第一行、系统顶栏（`safeAreaBar`）、固定在顶部（`safeAreaInset`，beta.2）、导航栏中间（小号）、右上角原地切换、右上角打开新的一页。用户在第一种和右上角之间比较后，选了右上角打开新的一页。预览和其余五种的代码已删。
- [x] `pages/components.tsx` 的 `StatsLink`：记录页右上角「+」旁边的统计图标，推入「油耗统计」「费用统计」（`FUEL_STATS_NAV`、`EXPENSE_STATS_NAV`），统计页不放车辆菜单和「+」。

## 1.6.0-beta.4：保险单独一个标签、费用只放车险以外

设计第 22 节（第七轮，用户 2026-10-22 确认方向）；草稿在画布「第七轮 · 1.6：油耗 · 费用 · 保险 · 设置」，用户在草稿上选定后再写界面代码。没有新的数据，账本格式不变。权益（1.7）和维修保养的里程、项目（1.8）不在这一版。

### 纯函数

- [x] `common/insurance.ts`：`isCarInsurance(years, r)`：关联了保险年度（`expense_id`）的费用，或「只有金额」的车险（与 `amountOnlyExpenses` 同一条件：类别 100002、备注含「险」、没有关联）。年检、牌照这类 100002 的费用不算。
- [x] `common/expense_stats.ts`：`withoutCarInsurance(entries, years)`，费用页和费用统计共用；费用页按年分组，组头的合计用 `expenseYears`（年份、合计、笔数、分类）。
- [x] `sync/xxyh/mapping.ts`：读小熊备份时类别按 `sortId` 排（没有 `sortId` 的排在后面）；本机类别按列表顺序。`ExpenseCategory` 不加字段，账本格式不变。
- [x] 记费用的分段（纯函数，`common/expense_stats.ts`）：
  - `formCategories(categories, editing)`：照类别列表的顺序，不含 100002；编辑一笔 100002 的费用时加上它；
  - `defaultCategory(entries, categories)`：最近一笔不是 100002 的费用的类别；没有时取第一类。
- [x] 删掉只给四种设计预览用的 `costYears`（`expense_stats.ts`）、`insuranceCostYear`（`insurance.ts`），连同它们在 `model.ts` 的再导出和测试（都还没提交）。
- [x] 测试：
  - `tests/insurance.test.ts`：`isCarInsurance` 认出关联了保险年度的、只有金额的；不认年检、牌照，也不认别的类别里备注带「险」的。
  - `tests/expense_stats.test.ts`：车险以外的费用；按年的合计；分段的顺序（按 `sort`、不含 100002、编辑 100002 时加上）；默认类别跳过 100002。
  - `tests/real_data.test.ts`（`XXYH_ROOT`）：最新的小熊备份里，车险以外的费用 + 车险 = 全部费用；车险的笔数等于保险年度和只有金额的笔数之和；费用页各年合计之和等于费用统计「全部」的合计。

### 页面

- [x] `pages/app.tsx`：标签 油耗 · 费用 · 保险 · 设置（`TAB_FUEL = 0`、`TAB_EXPENSE = 1`、`TAB_INSURANCE = 2`、`TAB_SETTINGS = 3`；「管理车辆」和没有车辆时跳设置的地方一起改）；保险标签 `systemImage="checkmark.shield"`；记保险、续保、保单详情、补充保单、忽略续保提醒的动作从 `ExpenseTab` 移到 `InsuranceTab`。
- [x] 新建 `pages/insurance_tab.tsx`（设计 22.7 节）：
  - `NavigationStack`；大标题「保险」，副标题车辆名 · 同步状态；左上角 `VehicleMenu`，右上角只有「+」（记保险，没有统计图标）；下拉同步。
  - 续保提醒；历年保险（`insuranceHistorySections`），正在保障的那一年展开成卡片，下一年已记下时排在卡片上面一行；都已到期时展开最近的一年。
  - 「只有金额」的一行：轻点打开记费用（编辑这笔，分段多出「保险和交通规费」并选中），左滑删除；「补充保单」照旧（一行里两个按钮都设 `buttonStyle`）。
  - 没有保险记录时：`ContentUnavailableView` 和「记保险」。
- [x] `pages/insurance_parts.tsx`：`CurrentPolicy` 改成卡片：去掉 `ProgressView`；加「比上一年的变化」和构成横条（`max` 用历年最大的实付，与 `YearRow` 相同）。`RenewalRow` 从 `expense_records.tsx` 移过来。
- [x] `pages/insurance_history.tsx`：保险页用 `insuranceHistorySections`，第一行可以换成卡片；删掉只给预览用的 `InsuranceHistoryPage`。文件头的说明改成「1.6.0-beta.4 起在保险页」。
- [x] `pages/insurance_detail.tsx`：改成推入页（设计 22.8 节，用户 2026-10-23）：去掉自带的 `NavigationStack` 和「关闭」，左上角返回、右上角「编辑」；删除后用 `EnvironmentValuesReader keys={["dismiss"]}` 回到保险页（`Navigation.useDismiss` 会关掉整个油记）。「没有对应的费用记录」的脚注不再说「统计里的花费」，改为说明小熊里没有这一年的保费。
- [x] `pages/expense_records.tsx`：去掉当前保单、续保提醒和保险行；只列车险以外的费用；按年分组，组头年份和合计；没有费用时的说明改为「点右上角的「+」记费用；车险在「保险」页。」
- [x] `pages/expense_tab.tsx`：「+」改成普通按钮，直接记费用（去掉 `Menu`）；`ExpenseTabActions` 去掉保险的动作；文件头的说明。
- [x] `pages/expense_stats.tsx`：只算车险以外的费用；去掉 `insuranceHistorySections`；「每年 · 保险以外」改成「每年」，列出有费用的年份（合计为 0 也列），脚注改成「按付款日期。」；合计和分类的脚注「只算费用，不含加油和车险；车险的保单和每年保费在「保险」页。小熊的保养记录和它关联的费用只算一次。」
- [x] `pages/expense_form.tsx`：类别改成第一行的分段（`Picker` `pickerStyle="segmented"`，`formCategories`）；超过 4 类时改成第一组的单选列表；新记时默认 `defaultCategory`；切换类别时时间、金额、备注保留；编辑时也显示分段，选中原来的类别；编辑 100002 的费用时多出这一类（这时 5 类，用单选列表）。
- [x] 删掉 `pages/expense_stats_designs.tsx`。
- [x] 推入的页面关闭用 `EnvironmentValuesReader keys={["dismiss"]}`（这一版是保单详情；1.7 的来源详情、权益详情、选择门店等照这样写）。

### FuelNote Check

- [x] `tools/check/runner.tsx`：删掉「费用统计的几种设计」（`DESIGNS`、`designPage`、`designActions`、`DesignPreview` 和检查页上那一组）。
  - 截图加 `insurance-records`（关联小熊那辆车的保险页）和 `expense-form`（记费用，新记）；`renewal` 改截保险页（「检查用车（续保提醒）」那辆车）。
  - `split` 核对：费用页、费用统计的合计不含车险；费用页各年合计之和等于费用统计「全部」；保险页的年数和电脑算的一致。
- [x] `tools/device_check.ts`：去掉 `designs`；`SHOTS_SPLIT` 加上 `insurance-records`、`expense-form`；`split` 发去的期望值加上车险以外的合计和各年合计。
- [x] `tools/check/README.md`：截图的名单。

### 文档和发布

- [x] `CLAUDE.md`（标签、页面权责、路线图）、`README.md`、`CHANGELOG.md`。
- [x] 设计第 22 节按实际实现修订。
- [ ] 发测试版 1.6.0-beta.4：先跑手机上的自动检查，看完全部截图（浅色、深色），再请用户看剩下的项目。

### 1.6.0-beta.5

用户在手机上看 1.6.0-beta.4（2026-10-23）：保险页左滑删除、确认时选「取消」后，那一行不见了，重新进入才出现。原因是左滑按钮设了 `role="destructive"`：一按下系统就把这一行划走，而油记要先确认，取消时数据没变、页面也不重新渲染。油耗、费用页的左滑删除是同样的写法。

- [x] `pages/components.tsx` 的 `swipeToDelete`：左滑「删除」用 `tint="systemRed"`，不设 role；油耗、费用、保险页的记录行都用它。记保险表单里的左滑（按下就删、不用确认）照旧。
- [x] `tests/syntax.test.ts`：这三个页面的左滑删除不能设 `role="destructive"`。
- [x] `E:\scripting\CLAUDE.md` 记下这条平台经验。

### 1.6.0-beta.6

用户在手机上看（2026-10-23）：保险页「只有金额」的那一笔，点进去是费用，不是保险。

- [x] `pages/insurance_history.tsx`：「只有金额」整行轻点打开记保险补充保单（补到这笔费用），右边「›」，横条旁边写「补充保单」；左滑删除照旧。去掉 `editExpense`。
- [x] 设计 22.7、22.9 节，README。

### 手机上的验收（1.6.0-beta.4）

编号接着 1.6 的 143–150；1.7 从 161 起（`docs/plans/2026-10-21-insurance-benefits.md`）。数字对照电脑上用同一份备份算的结果，不写进仓库。

151. 标签栏：油耗 · 费用 · 保险 · 设置，图标 `fuelpump`、`yensign.circle`、`checkmark.shield`、`gearshape`；打开时在油耗。
152. 保险页：大标题「保险」，副标题「车辆名 · 同步状态」；左上角车辆菜单，右上角只有「+」；下拉同步。
153. 保险页的历年保险：正在保障的那一年展开成卡片（徽章、保险公司、实付、比上一年、期间、还有几天、「报案」「保单 N 份」、构成横条，没有进度条）；下面每年一行，横条与卡片同一比例；实付和变化与电脑算的一致；缺的年份「补记」、只有金额的「补充保单」照旧。
154. 轻点卡片或任一年推入保单详情（左上角返回，「编辑」弹出记保险，删除后回到保险页）；轻点徽章全屏显示标志；「报案」能拨号；「保单 N 份」能打开原件。
155. 续保提醒（检查用车）在保险页最上面，「记保险」「×」照旧；费用页不再有续保提醒。
156. 费用页：只有车险以外的费用，按年分组，组头的年份和合计与电脑算的一致；保养只有一行；没有车险行；「+」轻点直接打开记费用，没有长按菜单。
157. 记费用：第一行是分段 行车费 · 维修保养 · 清洗护理 · 其它（小熊的顺序），新记时默认最近一笔费用的类别；切换类别时时间、金额、备注都在；编辑一笔费用时分段选中它的类别；保存后小熊里的类别正确。
158. 费用统计：不含保险；合计和分类、每年与费用页一致（合计为 0 的年份也在）；没有历年保险；脚注写明车险在「保险」页。
159. 切换车辆后油耗、费用、保险三个标签都跟着变；深色模式下保险页、费用页、记费用都看得清。
160. 回归：识别、记账、油耗与费用三项自动检查照常通过；保单详情、记保险表单、补充保单照旧。

自动检查和截图能覆盖 152–153、155–158 的显示和数字、159 的深色、160；仍要用户在手机上看的：标签栏、「+」的轻点、分段的切换（真实点按）、左滑和下拉、徽章全屏、「报案」拨号、「保单 N 份」打开原件、切换车辆、保存到小熊。

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

后来的改动：145 的「导航栏中间切换」在 1.6.0-beta.3 改成记录页推入的统计页；146、147 里的保单卡、续保提醒、长按「+」记保险和费用统计里的保险，在 1.6.0-beta.4 移到保险页，以 151–160 为准。
