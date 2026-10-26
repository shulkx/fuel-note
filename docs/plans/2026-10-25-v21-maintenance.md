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

设计第 3–9、12 节，画布第十五轮（用户 2026-10-26 选定）。第十轮的养修稿子画于 2.0 之前，已按 2.0 的规则重画。

- [x] 数据（`common/types.ts`、`common/ledger_file.ts`）：`ServiceVisit`、`ServiceTicket`（加 `discounts`，`prefs` 带沃尔沃的类型只显示）、`ServiceRecord`；`LedgerFile.service_records`（读账本时补空数组，检查记录 id 都在）；`Perk.start_ts`（可选）。
- [x] 提供方（`providers/types.ts`、`providers/volvo_cn.ts`、`providers/volvo_service.ts`）：可选的 `serviceVisits`（列表，去掉已取消的）、`serviceVisit`（工单号、经销商、委托单、结算 4 次请求）；结算整理成通用结构：优惠名去掉车牌和券号、其他减免、抹零按差额；经销商坐标 GCJ-02 换成 WGS-84；`serviceTitle`（「沃尔沃养修」）。项目整理规则（设计第 5 节）放在 `volvo_service.ts`：去「工时：」、不记的、写进备注的、原厂基础保养 = 机油 <标号> + 机油滤清器、去「更换」、斜杠取主名、别名从全部养修记录收集、去重。
- [x] 纯逻辑（`common/service.ts`）：记没记（设计第 7 节）、进店的叫法（第 8 节）、从养修填写的表单内容（时间、里程、项目、备注、实付默认值、另记的工单）、先勾好的权益（第 12 节三条规则，对得上的正好一张时）、沃尔沃的叫法（工单项目加账本里用过的，按次数）、找门店（经销商代码 → 名称或 300 米内）、保存（保养记录和费用、另记的费用、使用、`service_records`、把经销商代码写进门店）。
- [x] 权益的有效期起（`common/perks.ts`）：`usablePerks` 按费用的时间只列有效期包含那天的卡（`start_ts`；没有时车险赠送取那一年保险的购买日，其余取添加那天）；编辑一项、编辑一批可以改有效期起。
- [x] 读取和缓存（`app/service.ts`，缓存用 `platform/storage.ts` 的 readCache/writeCache）：`service_visits.json`（列表时间、进店列表、结算过的明细）；第 6 节的读取时机（24 小时、停在带经销商代码的门店附近 1 小时以上、有还没结算的每 10 分钟、下拉强制）；明细结算后只读一次；失败时照旧用缓存，养修记录页写原因。
- [x] 页面：费用页最上面「沃尔沃养修」一组（`pages/expense_records.tsx`）；养修记录页（`pages/service_visits.tsx`，新）；记费用从养修填写（`pages/expense_form.tsx`：来源一行、实付、沃尔沃结算只读、另记的工单、关联了养修的费用编辑时同样显示）；使用权益页上面的对照（`pages/benefit_pick.tsx`，关联了养修时没有「实付」一行）；保养项目页（`pages/maintenance_items.tsx`：第二行写来自哪个工时、写进备注的可以改成项目、候选是沃尔沃的叫法）；选择门店写「沃尔沃经销商」、附近按经销商坐标；门店详情的经销商代码（可以清除）。
- [x] 删除：删掉养修记成的费用时，这次进店的记录都没有了才删 `service_records`（回到没记）。
- [x] 测试：`tests/service.test.ts`（合成的工单覆盖每条项目规则、优惠名清理、抹零、叫法、记没记、先勾好的规则、保存和删除）；`tests/perks.test.ts` 加有效期起；`tests/real_data.test.ts` 用 `XXYH_ROOT/out/volvo_probe` 核对：结算过的 10 次进店、没记的进店数、项目整理结果。
- [x] FuelNote Check：`/run/service`（STAMP 36）：电脑把 `out/volvo_probe` 整理好的进店发给手机（结算备注里的电话去掉），在检查用的文件夹里核对记没记、从养修填写的内容、保存和删除；截图费用页一组、养修记录、从养修填写（2026/4/3、2024/10/11）、使用权益（新旧工单）、保养项目、选择门店、门店详情。不联网、不读钥匙串。
- [x] 文档：CLAUDE.md、README、CHANGELOG、`tools/check/README.md`。
- [x] 补录（不进仓库）：数据结构写好后，用户发最新备份，按本机的补录计划用同一套保存代码生成一份备份给用户恢复（记忆 fuelnote-beta5-backfill）。用户 2026-10-26 已导入。

## 2.1.0-beta.6：费用页的标题

用户 2026-10-26 看补录后的费用页：「保养的标题不直观，直接把备注放到标题了，不如我之前的第x次保养，如果是喷漆，应该用更直观的标题」。按整份清单（标题和备注）审过后定的规则，见设计第 8 节「费用页一行的标题」和设计文档 22.5 节。以后新记的照规则生成，不用大模型。

- [x] `common/service.ts`：`oilChangeNumbers`（换了机油的保养按时间编号）、`ticketTitle`（另记一笔的工单按做了什么）、`entryTitle`（费用页一行）；`ticketRemark` 只写项目名，不写优惠。
- [x] `providers/volvo_service.ts`：喷漆写进备注时写成「补漆：左前门、左后门」。
- [x] `pages/expense_records.tsx`：标题用 `entryTitle`。
- [x] 测试：`tests/service.test.ts` 加标题的两条，改备注的两处。
- [x] FuelNote Check：`/run/service` 加一步，换了机油的保养都写第几次保养（STAMP 37）。
- [x] 用户的数据（不进仓库）：导入的补录里三条备注照新写法改好，生成备份给用户恢复。

## 2.1.0-beta.7：使用记录写费用的标题

用户 2026-10-26 同意：权益详情的使用记录原来写「2024/10/11 的费用 · 实付 ¥300.00」，看不出那天做了什么。

- [x] `common/service.ts` 的 `expenseTitle`：一笔费用在费用页的标题（带保养记录的合成一行算）。
- [x] `pages/benefit_detail.tsx`：记在费用上的第二行写 日期 · 标题 · 实付。
- [x] 测试：`tests/service.test.ts` 的标题一条加 `expenseTitle`。

## 手机上的验收（2.1）

1. 2.1.0-beta.1：记费用选维修保养，下面多一组「保养」，里程是车况的里程表；选两个项目保存后，费用页里合成一行。
2. 轻点这一行：类别锁住、写明原因；改里程和项目后保存，费用页跟着变；去掉全部项目保存，费用页里只剩费用，再打开能改类别。
3. 轻点第五次保养：备注只有「第五次保养」，没有「保养里程」「保养项目」两行。
4. 左滑删除一条保养：确认里写「保养记录和这笔费用一起删除」，删后两条都没有了。
5. 导出预览里，改过和新记的保养照常列出；导出后在小熊 App 里看：项目、保养和费用配成一次保养（设计第 14 节第 1 条，导出前先问用户）。
6. 2.1.0-beta.2：记费用 › 门店：顶部能搜索高德；我的门店第二行是地址；车辆有行程时列出那时停车的地方附近；选中一家后它出现在我的门店里。
7. 轻点 ⓘ：门店详情的名称能改（费用页跟着变），电话能拨，「在地图中打开」落在店里，「重新定位」能换一个地点，用到这家店的条数对。
8. 添加权益识别出的店名不在我的门店里时标橙，轻点后搜索框里是这个店名。
9. 2.1.0-beta.5：费用页最上面有「沃尔沃养修」一组（第一次打开要读一会儿），写几次没记；「全部养修记录」里没记、已记分两组，取消的预约不列出。
10. 轻点「记下」：来源一行、门店（按经销商找到时标橙）、实付、使用权益（按工单先勾好的标橙）、里程、项目（第二行写来自哪个工时，检查可以改成项目）、沃尔沃结算只读；2024/10/11 那次另记的两张补漆工单各有实付和使用权益。保存后这次进店移到已记，门店详情里有经销商代码。
11. 编辑一笔养修记成的费用：照样有来源一行、实付、沃尔沃结算；使用权益只列那一期的权益，上面对照着工单的优惠。
12. 2.1.0-beta.6：费用页里换了机油的保养是「第一次保养」到「第九次保养」；补漆、钣金、维修、保修、事故维修各行写着做了什么和部位；米其林轮胎、刹车片、感恩特惠照旧。
13. 2.1.0-beta.7：权益 › 2024 车险的油漆面：使用记录写「2024-10-11 · 补漆 · 前保、后保 · 实付 ¥300.00」；基础保养写「2024-10-11 · 第七次保养 · 实付 ¥0.00」。
