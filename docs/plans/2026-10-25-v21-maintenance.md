# 油记 2.1：记保养与沃尔沃养修 — 实施文档

- 设计：`docs/specs/2026-10-24-maintenance-volvo.md`（第 2 节的决定用户 2026-10-23、10-24 确认；记保养的界面用户 2026-10-25 选定画布第十三轮）。
- 分期见设计第 15 节：beta.1 记保养，beta.2 门店接高德，beta.3 沃尔沃养修。
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

设计第 10 节。开工前先对照画布第十轮的门店稿子，按 2.0 的规则需要改的重新出稿。

## 2.1.0-beta.3：沃尔沃养修

设计第 3、4、6–9、12 节。开工前先对照画布第十轮的养修稿子，按 2.0 的规则需要改的重新出稿。

## 手机上的验收（2.1）

1. 2.1.0-beta.1：记费用选维修保养，下面多一组「保养」，里程是车况的里程表；选两个项目保存后，费用页里合成一行。
2. 轻点这一行：类别锁住、写明原因；改里程和项目后保存，费用页跟着变；去掉全部项目保存，费用页里只剩费用，再打开能改类别。
3. 轻点第五次保养：备注只有「第五次保养」，没有「保养里程」「保养项目」两行。
4. 左滑删除一条保养：确认里写「保养记录和这笔费用一起删除」，删后两条都没有了。
5. 导出预览里，改过和新记的保养照常列出；导出后在小熊 App 里看：项目、保养和费用配成一次保养（设计第 14 节第 1 条，导出前先问用户）。
