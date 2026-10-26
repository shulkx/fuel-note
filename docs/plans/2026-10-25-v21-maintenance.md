# 油记 2.1：记保养与沃尔沃养修 — 实施文档

- 设计：`docs/specs/2026-10-24-maintenance-volvo.md`（第 2 节的决定用户 2026-10-23、10-24 确认；记保养的界面用户 2026-10-25 选定画布第十三轮）。
- 分期见设计第 15 节：beta.1 记保养，beta.2 门店接高德，beta.3 修正门店搜索，beta.4 修正 0 元费用，beta.5 沃尔沃养修。
- 约定沿用 `CLAUDE.md` 和 2.0 实施文档：纯逻辑放 `common/`、`sync/`；入口只从一个模块导入；泛型写成函数声明或 `<T,>`；可选属性不传 `undefined`。
- 每个测试版：先写 CHANGELOG → `npm run bump -- x.y.z` → `npm run check` 和 `XXYH_ROOT=E:/GitHub/xxyh npm test` 都退出 0 才提交 → `git tag -s`，不推送 → 跑 FuelNote Check、看完截图 → 再请用户看剩下的项目。

## 2.1.0-beta.1：记保养

设计第 5、11 节，画布第十三轮（MtForm、MtItems、MtEdit、MtDelete）。

- [x] `common/maintenance.ts`（新，纯）：`maintenanceOf`；`putMaintenance(ledger, expenseId, input)`——维修保养、填了项目时存（或更新）保养记录，时间和金额跟着费用，导入的留着 `xxyh_raw`；没项目、换了类别、`null` 时删掉；`usedItems`（按次数排，次数一样时最近用过的在前）。
- [x] `common/ledger.ts` 的 `removeRecord`：删费用时它的保养记录一起删；删保养时连费用一起删（原来只去掉关联）。
- [x] `app/records.ts` 的 `saveExpense` 多一个参数 `maintenance`（不传时不动保养记录，权益、保险那些入口照旧）。
- [x] `pages/expense_form.tsx`：维修保养多一组「保养」——里程（新记时默认取车况的里程表）、项目（推入 `pages/maintenance_items.tsx`）；带保养记录的费用类别锁住、分段下面写明原因；备注是保养的说明，没改时费用和保养的备注都照旧。
- [x] `pages/maintenance_items.tsx`（新）：已选的（红色按钮去掉，按加进来的先后排）；输入名称（回车或「添加」），或点用过的项目（`FlowLayout`，每个按钮都设 `buttonStyle`）。
- [x] `pages/app.tsx`：轻点费用页的保养行打开记费用（保养和费用一起改）；保养行能左滑删除，确认里写「保养记录和这笔费用一起删除」；没配上费用的保养照旧只能查看。
- [x] 导出（`sync/xxyh/export.ts`、`mapping.ts`）：新记的保养项目不带结尾的逗号（`maintainsText`）；带保养记录的费用，小熊的备注由保养的说明、「保养里程」「保养项目」两行生成，项目没改过的照小熊原来的写法；导入以后两条都没改过的照原样。
- [x] 测试：`tests/maintenance.test.ts`；`tests/ledger.test.ts`（一起删）；`tests/export.test.ts`（不带结尾逗号、改过以后的备注）；`tests/real_data.test.ts`（7 笔导入的保养费用备注换成保养的说明后，导出的和小熊里一字不差）。
- [x] FuelNote Check：`split` 里记一条保养、改、看导出的格式、删掉（数据回到原样）；截图：新记、编辑第五次保养、保养项目页。STAMP 33。
- [x] `CHANGELOG.md`、`README.md`、`CLAUDE.md`、`tools/check/README.md`、映射文档。

## 2.1.0-beta.2：门店接高德

设计第 10 节，画布第十四轮（第十轮的门店稿子画于 2.0 之前，按 2.0 的规则重画）。

- [x] `common/types.ts`：`Store` 加 `hours`、`poi_id`、`dealer`；新类型 `StorePoi`。`common/ledger_file.ts` 读账本时给门店补上这几个字段（2.0 只填名字的门店不另作状态）。
- [x] `stations/store_search.ts`（新，纯）：高德 v5 `place/around`、`place/text`，类型限汽车销售、维修、养护、洗车场，`show_fields=business` 取电话和营业时间，坐标换成 WGS-84。`stations/search.ts` 的 `amapGet` 导出共用。
- [x] `common/stores.ts`：`shortStoreName`（去掉末尾括号里的分店名）、`storeFromPoi`、`relocatedStore`（id、名称、经销商代码不变）、`storeOfPoi`、`storeUsage`、`parkedAt`（记费用那时车停的那一站）；`addStore` 按高德地点 id 去重，不再按名称。
- [x] `app/stores.ts`（新）：`canSearchStores`、`searchStores`（优先最近用过的油站所在城市）、`nearbyStores`、`parkedPlace`（用 `stopsForPayment` 的停车）。FuelNote Check 的数据文件夹里不读钥匙串，不能搜索。
- [x] 页面：`pages/store_picker.tsx` 重写（搜索栏、我的门店带 ⓘ、记费用时那时停车的地方附近；去掉新建门店和左滑改名）；`pages/store_search.tsx`（新：搜索结果、重新定位的搜索页）；`pages/store_detail.tsx`（新）。`StorePicker` 多两个参数 `near`、`query`；记费用传这一笔的时间。
- [x] `pages/benefit_form.tsx`：识别出的店名不在我的门店里时标橙，轻点打开选择门店、搜索框填好店名；不再退回去填最近一次维修保养的门店。
- [x] 测试：`tests/stores.test.ts`；改了门店数据的旧测试补上新字段；`perk_ledger` 的「同名不重复加」改成「同一个高德地点不重复加」。
- [x] FuelNote Check：权益一项建的门店用高德的全称和编的地点 id；截图加门店详情。STAMP 34。
- [x] 数据：2.0 里只填名字的门店，用户同步 beta.2 前删掉（不写转换）。

## 2.1.0-beta.3：修正门店搜索

用户 2026-10-26：beta.2 在手机上搜「交运起豪」显示「没有找到」。用电脑按同样参数查高德能查到 3 条；把中文关键字编码两次时高德返回 OK、0 条，和手机上的现象一样。原因是网址里类型之间的「|」没有编码，手机上整个网址被再编码一次。

- [x] `stations/store_search.ts`：类型参数自己编码（`%7C`）；`tests/stores.test.ts` 检查网址里没有没编码的字符。
- [x] 选择门店的说明不再写「上面搜索」（iOS 26 的搜索栏在底部）。

## 2.1.0-beta.4：费用可以记 0 元

用户 2026-10-26 问「费用不允许 0 元吗」：`checkExpense` 要求金额大于 0，导入的 0 元保养编辑后存不了，也和设计第 2 节「自付为 0 也记」不符。

- [x] `common/form.ts` 的 `checkExpense`：要填，可以是 0，不能是负数；`tests/core.test.ts`。

## 2.1.0-beta.5：沃尔沃养修

设计第 3–9、12 节。开工前先对照画布第十轮的养修稿子，按 2.0 的规则需要改的重新出稿。

- 项目名用沃尔沃的叫法（设计第 5 节，用户 2026-10-26）：只清理（「工时：」「更换」、斜杠取主名、「服务关怀-X」），按读到的全部养修记录里的斜杠别名统一，不手写对照表。
- 保养项目页的候选改成「沃尔沃的叫法」：全部养修记录整理出的项目名加账本里用过的，按出现次数排（`common/maintenance.ts` 的 `usedItems` 跟着改）。手动记保养也用它。
- 测试用合成的工单名称覆盖每条规则；`tests/real_data.test.ts` 用 `XXYH_ROOT/out/volvo_service_orders.json` 核对：10 张保养工单 → 18 种项目。

## 手机上的验收（2.1）

1. 2.1.0-beta.1：记费用选维修保养，下面多一组「保养」，里程是车况的里程表；选两个项目保存后，费用页里合成一行。
2. 轻点这一行：类别锁住、写明原因；改里程和项目后保存，费用页跟着变；去掉全部项目保存，费用页里只剩费用，再打开能改类别。
3. 轻点第五次保养：备注只有「第五次保养」，没有「保养里程」「保养项目」两行。
4. 左滑删除一条保养：确认里写「保养记录和这笔费用一起删除」，删后两条都没有了。
5. 导出预览里，改过和新记的保养照常列出；导出后在小熊 App 里看：项目、保养和费用配成一次保养（设计第 14 节第 1 条，导出前先问用户）。
6. 2.1.0-beta.2：记费用 › 门店：顶部能搜索高德；我的门店第二行是地址；车辆有行程时列出那时停车的地方附近；选中一家后它出现在我的门店里。
7. 轻点 ⓘ：门店详情的名称能改（费用页跟着变），电话能拨，「在地图中打开」落在店里，「重新定位」能换一个地点，用到这家店的条数对。
8. 添加权益识别出的店名不在我的门店里时标橙，轻点后搜索框里是这个店名。
