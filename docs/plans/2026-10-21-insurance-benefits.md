# 油记 1.5–1.8：保险与权益 — 实施文档

- 设计：`docs/specs/2026-10-18-fuelnote-design.md` 第 20 节；界面草稿在画布「保险」「权益」「保障标签页」三行。
- 目标：1.5 保险，1.6 权益与核销，1.7 用大模型识别保单和权益，1.8 记保养。每期单独发布，前一期在手机上验收通过再开始下一期。
- 技术栈不变：TypeScript + Scripting；Node 24 + tsx + node:test；tsc 用 `../../dts` 做类型检查。
- 约定沿用 `CLAUDE.md`：纯逻辑放 `common/`（不导入 `"scripting"`），Scripting 相关的放 `platform/`、`pages/`、`common/model.ts`；入口只从一个模块导入；泛型箭头函数写成函数声明；frame 不混写；可选属性不传 `undefined`。

## 状态（2026-10-21）

- 1.5.0-beta.1 已完成，等手机验收（第 128–138 项）。保单解析用电脑上 pdftotext 取出的文字核对过：17 份保单逐项一致，3 张标志认出不是保单；手机上 PDFKit 的文字还没采到，采到后再核对一遍。

- 设计第 20 节已写；界面草稿已出，用户选定「保障」标签页的方案。
- 用户已确认：费用写实付、抵扣写进备注；保单自带的服务默认不追踪；指定门店；记保养放到最后一期，先在记费用里核销。
- 待确认：
  1. 1.7 保单「统一格式用规则，其他格式交给大模型」（设计 20.9 节），与加油截图「只用一种识别方式」不同。
  2. 用户提供往年送过的权益条目（1.6 开工前，用来检验金额型、次数型、套餐、门店、单次上限够不够用，并替换草稿里的示例）。
  3. 「保障」这个标签名。
- 2021 年平安的保单还在找，不影响开发：历年列表里它是「只有金额」。

## 验证命令

```sh
npm run check                              # 类型检查
npm test                                   # 合成数据
XXYH_ROOT=E:/GitHub/xxyh npm test          # 另外核对真实保单文字和小熊备份（只读）
```

每一批交给手机验收时按 `CLAUDE.md`「Versions」发测试版：先写 CHANGELOG → `npm run bump -- x.y.z-beta.n` → `npm run check` 和 `XXYH_ROOT=E:/GitHub/xxyh npm test` 都退出 0 再提交 → `git tag -s`，不推送。

## 分期

| 版本 | 内容 | 前提 |
|---|---|---|
| 1.5 | 保险：保障标签页（当前保单、历年保险）、保单详情、记保险（PDF 规则读取、手动）、关联费用、续保提醒、记录页的保险行 | PDFKit 文字采样 |
| 1.6 | 权益：列表和详情、添加权益、我的门店、记费用时核销、单独记使用、套餐、到期提醒、统计的权益抵扣 | 1.5；用户的往年权益条目 |
| 1.7 | 大模型识别：非统一格式的保单、权益的文字和截图；脱敏 | 1.5、1.6；待确认第 1 项 |
| 1.8 | 记保养：表单、小熊保养记录的读写、本机保养记录、记保养时核销 | 1.6 |

1.7 和 1.8 互不依赖，用户可以决定先做哪一个。

## 1.5：保险

### 1.5.0 之前：在手机上采集保单 PDF 的文字

PDFPage 只给整页文字，表格的名称和数值可能分开，各家的排列不同。先拿到 PDFKit 在手机上取出的真实文字，再写解析规则。

- [x] 把 OneDrive `Insurance\Car Insurance` 下 6 个年度文件夹的 20 个 PDF（17 份保单、3 张交强险标志；2026 年的标志是 JPG，不算）复制到 `XXYH_ROOT/materials/insurance/<年度文件夹>/`；样本不进本仓库（xxyh 仓库忽略 `materials/`、`out/`）。
- [x] `tools/ocr_bridge.mjs`：
  - 清单 `GET /list` 加上 `materials/insurance/**/*.pdf`，每项多一个 `kind: "pdf" | "image"`；
  - `GET /pdf?id=` 发文件（只发清单里的）；
  - `POST /pdf_result` 收 `{ file, pages: string[], ms }`，追加到 `out/insurance/pdfkit.jsonl`；
  - PDF 的 `done` 按 `pdfkit.jsonl` 判断。
- [x] `tools/probe/index.tsx`：清单里 `kind === "pdf"` 的项，用 `PDFDocument.fromData(await res.data())` 逐页取 `await page.string`，传回电脑；图片照旧。
- [x] `XXYH_ROOT/out/insurance/expected.json`：按设计 20.5 节逐份写期望值，键为文件相对路径：
  `{ kind, title, insurer, policy_no, start, end, premium, premium_ex_tax, tax, float_rate, vehicle_tax, phone, items: [{ key, amount, amount_text, premium, times }] }`。数字取自前面对 PDF 的核对。真实保单的数字只放在这里，不进仓库。
- 验证：手机上跑 `FuelNote Probe`，20 个 PDF 都有结果。把 PDFKit 与 pdftotext 在明细排列上的差别（按行还是按列、期间是否被拆开）记到本文的这一节，作为解析规则的依据。

### 1.5.0-beta.1 第一部分：数据、解析、关联费用

只有数据层时手机上没有东西可验收，所以和界面合成一个测试版。

- [x] `common/types.ts`：设计 20.4 节的 `PolicyKind`、`PolicyItem`、`Policy`、`InsuranceYear`；`LedgerFile.insurance?: InsuranceYear[]`；`Settings.dismissed_renewals?: string[]`。都是可选字段，`schema_version` 不变，旧文件照常读。
- [x] `common/insurance_catalog.ts`（纯）：
  - `CATALOG`：`{ key, short, group, pattern }[]`，group 为 `main | addon | service | legacy | ev | accident | non_vehicle`，key 见设计 20.5 节；`pattern` 覆盖别名（例如代为送检的三种写法、医保外医疗的三种括号）。
  - `itemKey(name: string): string | null`；`catalogEntry(key)`。
  - `insurerShort(full: string): string`（中国平安、中国人寿、中国人保、太平洋、大地、阳光、太平、华安、天安、永安；其余去掉「财产保险股份有限公司」及后面的分支机构）；`insurerPhone(full: string): string | null`（只内置平安 95511、人寿 95519，其余以保单上读到的为准）。
- [x] `common/policy_text.ts`（纯）：`parsePolicyText(pages: string[]): ParsedPolicy`，`ParsedPolicy = Omit<Policy, "file"> & { vin: string | null; sign_ts: number | null }`。按设计 20.5 节的表逐项读取；导出供测试的 `parseChineseAmount(s)`、`parsePeriod(text)`、`parseItems(text, total)`。
  - 时间一律按北京时间（UTC+8）换算，不用设备时区；「24 时」「二十四时」= 当天 23:59:59.999。
  - 明细：先按行，再按顺序配对，最后用合计核对（设计 20.5 节）；对不上时 `issues` 写「险种明细与保险费合计不符，请核对」，`premium` 留 null。
  - 保费数字与大写金额不一致、期间读不全、标题认不出时，各写一条 `issues`。
- [x] `common/insurance.ts`（纯）：
  - `yearTotal(y)`、`yearPeriod(y)`（最早起保 – 最晚到期）、`yearOf(y)`（起保年份）、`yearInsurer(y)`（简称）、`yearPhone(y)`；
  - `composition(y)`：商业险 / 交强险和车船税 / 驾乘意外及其他三段金额；
  - `insuranceYears(ledger, vehicleId)`（按起保日倒序）、`currentInsurance(years, now)`、`previousInsurance(years, y)`；
  - `itemCompare(y, prev)`：按 key 对上一年，返回每项去年的保额和保费；
  - `yearGaps(years)`：相邻两年的期间之间空了 30 天以上的年份（用户的 2024 年在补上之前就是这样）；
  - `amountOnlyExpenses(records, years)`：类别 100002、备注含「险」、没有被任何保险年度关联的费用；
  - `expenseCandidates(records, years, paidTs)`：付款日期前后 45 天内、类别 100002、未关联的费用，按日期差排序；
  - `renewalDue(years, now, dismissed, days = 45)`：当前保单 45 天内到期、还没有起保日更晚的下一年、没点过「×」时返回它；
  - `expenseFor(y, label)`：`{ ts: paid_ts, category_id: 100002, amount: yearTotal(y), remark: "2026 车险 · 中国平安" }`。
- [x] `common/ledger.ts`：
  - `putExpense` 返回值加 `recordId`（本机新建时的 id；小熊车辆为 null，保存后再找）；
  - `putInsurance(data, vehicle, year, amount: "total" | "keep")`：写这一年的保险，并新记或更新对应的费用（`keep` 时不改已有费用的金额）；
  - `linkInsuranceExpenses(data)`：小熊车辆在 `commit` 之后，按（时间、类别 100002、金额）在镜像里找到费用，更新 `expense_id`；
  - `removeInsurance(data, vehicle, id, withExpense: boolean)`；
  - `removeRecord` 删除有关联保险的费用时，一起删除那一年的保险，并返回被删的保险年度 id（用来删原件）。
- [x] `platform/pdf.ts`：`readPdfPages(path): Promise<string[]>`（`PDFDocument.fromFilePath`，逐页 `await page.string`，`null` 当作空串）。
- [x] `platform/storage.ts`：`savePolicyFile(yearId, srcPath, name): string`（复制到 `FuelNote/insurance/<yearId>/`，返回相对路径；重名加序号）、`policyFilePath(rel)`、`removePolicyFiles(yearId)`。
- [x] `common/model.ts`：`saveInsurance`、`deleteInsurance`、`readPolicyFiles(paths)`（读文字 + 解析，返回每个文件的 `ParsedPolicy`）、`insuranceForRecord`（记录页的费用对应哪一年的保险）、`dismissRenewal`；并把页面要用的 `common/insurance.ts` 函数和类型从这里再导出。删除保险或删除带保险的费用后删原件。
- [x] `common/backup.ts`：`BackupSummary.insurance_years`；恢复确认里显示「保险 N 年」；原件不进备份。
- 测试：
  - `tests/policy_text.test.ts`：合成样本（编造的公司名、号码、金额），覆盖设计 20.10 节列出的写法：四种期间写法，平安、人寿、意外险的保费写法，按行和按列的明细，大写金额核对（`伍仟零陆拾贰元贰角` = 5062.2，`叁佰陆拾元整` = 360），2020 年改革前条款，交强险的浮动比率和车船税，读不全时的 `issues`。设置 `XXYH_ROOT` 时，逐份对照 `pdfkit.jsonl` 和 `expected.json`：17 份保单全部一致，3 张标志都认出「不是保单」，才算通过。
  - `tests/insurance.test.ts`：合计（各份保费 + 车船税 − 优惠）、期间和年份（商业险晚一个月起保仍算这一年）、缺年份、只有金额的费用、候选费用（±45 天）、续保提醒（45 天内、已记下一年、点过「×」三种情况）、`itemCompare`。
  - `tests/ledger.test.ts`：本机车辆新记、编辑、删除保险时费用跟着变；小熊车辆生成 `put_expense` 操作、`linkInsuranceExpenses` 找回 id、`validateUpload` 通过；补到已有费用（`total` 改金额、`keep` 不改）；删除带保险的费用会删掉那一年的保险。
  - `tests/backup.test.ts`：带保险的账本备份、恢复后保险还在，摘要里的年数正确。
- 文档：设计 20 节按实际实现修订；本节记下 PDFKit 采样的结论。

### 1.5.0-beta.1 第二部分：界面

- [x] `pages/app.tsx`：标签改为 记录 · 统计 · 保障 · 设置（`TAB_COVERAGE = 2`，`TAB_SETTINGS = 3`，「管理车辆」跳设置的地方一起改）；`openInsuranceForm(vehicle, year | null, linkExpense?)`、`openInsuranceDetail(year)`；保存后照旧 `afterChange` 上传；删除时用 `Dialog.actionSheet` 问「删除保单和费用」「只删除保单明细」。
- [x] `pages/coverage.tsx`（保障页，草稿「新标签页『保障』」去掉权益一组）：
  - 左上角 `VehicleMenu`，右上角「+」（记保险）；
  - 当前保单：保险公司 · 实付，期间和剩余天数，进度条，「报案 <电话>」（`Safari.openURL("tel:…")`）、「保单 N 份」（`QuickLook.previewURLs`）；
  - 历年保险：年份、保险公司、实付、三段横条（宽度按历年最大值）、比上一年的变化（高出 10% 以上橙色）；缺的年份「没有记录 · 补记」；「只有金额」一组带「补充保单」；
  - 没有记录时 `ContentUnavailableView` 和「记保险」。
- [x] `pages/insurance_detail.tsx`：设计 20.6 节「保单详情」；保单号用 `Pasteboard.setString` 复制；「编辑」「删除」；找不到对应的费用（在小熊 App 里删了）时写「没有对应的费用记录」，并提供「重新记一笔」；`issues` 显示在对应保单下面。
- [x] `pages/insurance_form.tsx`：设计 20.6 节「记保险」；`DocumentPicker.pickFiles({ types: ["com.adobe.pdf"], allowsMultipleSelection: true })`；读出结果和 `issues` 显示在每个文件一行；车架号不符时提示；有改动时禁止下滑关闭；什么都没改时「保存」直接关闭。
- [x] `pages/insurance_form.tsx` 里的 `PolicyEdit`、`ItemEdit`：一份保单的种类、标题、保险公司、保单号、期间、保费、浮动比率、车船税、险种列表（增、删、改：名称、保额或「N次 / 共享」、保费）。
- [x] `pages/records.tsx`、`pages/components.tsx`：
  - 有保单明细的费用用保险行（盾牌图标、「车险 · 中国平安」、期间），点开是保单详情；
  - 续保提醒一行（`renewalDue`），「记保险」打开表单，「×」写进 `dismissed_renewals`；
  - 「+」菜单加「记保险」。
- [x] `pages/backup_settings.tsx`：脚注写明保单原件不在备份里。
- [x] `CHANGELOG.md`、`README.md`。
- 验证：`npm run check`、`tests/syntax.test.ts`（TSX 解析、frame 不混写）、`tests/widget_imports.test.ts`（小组件不受影响）。

手机上的验收（1.5）。用户保单的具体数字不写进仓库，对照本机的 `XXYH_ROOT/out/insurance/expected.json`：

128. 「保障」标签：标签栏 4 个，左上角车辆菜单、右上角「+」。还没有保险时显示说明和「记保险」。
129. 记保险 → 选最近一年的 3 份 PDF：交强险的保费和浮动比率、车船税、商业险的每个险种（保额、保费、服务次数）、搭售的保障、期间、付款日期都与 expected.json 一致，商业险显示「合计相符」；实付是三份保费加车船税。
130. 保存后：记录页付款那个月出现保险行，金额是实付，月合计相应增加；上传到小熊；保障页当前保单正确，「报案」能拨号，「保单 N 份」能打开原件。
131. 补小熊里已经记了金额的那一年：表单提示「补到」那笔费用，保存后不新增费用，金额不变。
132. 补小熊里金额和保单合计不同的那一年：提示二选一；选「保留原金额」后费用不变。
133. 补其余年份：商业险晚一个月起保的那年，年份仍按交强险的起保年算。历年列表每年一行；只在小熊里记了金额、没有保单的那年在「只有金额」里，没有误报「没有记录」。
134. 保单详情（最近一年）：比上一年的变化、车损险的「去年」金额、交强险「浮动 · 去年」与 expected.json 算出的一致；保单号能复制。
135. 续保提醒：用一辆本机测试车记一份 20 天后到期的保险，记录页出现提醒；点「×」后不再出现；记下一年后也不再出现。
136. 删除：在记录页删除保险费用，提示保单明细一起删除；在详情里删除时可以选只删明细。删除后原件也删掉。
137. 深色模式下保障页、详情、表单都看得清。
138. 备份后恢复，保险都在；备份页写明原件不在备份里。

用户确认后发布 1.5.0。

## 1.6：权益与核销

开工前：拿到用户往年的权益条目，核对设计 20.7 节的数据结构；把画布权益一行的示例换成真实数据；在本节细化到函数和测试用例。

- [ ] `common/types.ts`：`Store`、`Benefit`、`Redemption`；`LedgerFile.stores?`、`benefits?`、`redemptions?`、`record_meta?`。
- [ ] `common/benefits.ts`（纯）：剩余、是否过期、`usableBenefits(benefits, { storeId, categoryId, ts })`、默认抵扣 `min(余额, 金额, 每次上限)`、`expiringBenefits(now, 30)`、保单增值服务生成权益（`tracked: false`）、从费用备注最后一行和保单销售渠道找门店。
- [ ] `common/ledger.ts`：保存费用时一起写核销和 `record_meta`（编辑时替换、删除时撤销）；小熊车辆的费用金额写实付、备注加抵扣和门店；购买套餐时记一笔费用。
- [ ] 页面：保障页「权益」一组（`pages/coverage.tsx`）；`pages/benefit_detail.tsx`；`pages/benefit_form.tsx`；`pages/store_picker.tsx`（我的门店、高德搜索汽车销售和维修地点、新建）；`pages/expense_form.tsx` 加门店、使用权益、实付；`pages/insurance_form.tsx` 加「赠送」一组；记录页的到期提醒并进续保提醒；统计页的权益抵扣。
- 测试：`tests/benefits.test.ts`；`tests/ledger.test.ts` 的核销、撤销、小熊备注；`tests/backup.test.ts`。
- 手机上的验收从 139 开始编号，开工时补上。

## 1.7：大模型识别保单和权益

开工前：用户确认设计 20.9 节的「规则优先」。

- [ ] `readers/policy_llm.ts`、`readers/benefit_llm.ts`（纯）：提示词、JSON schema、把回复转成 `ParsedPolicy` / 权益草稿、本地核对（保险费合计、期间、险种 key 在本机对应）；`redactText(text)` 去掉身份证号、手机号、地址、车架号、发动机号、号牌。
- [ ] `platform/assistant.ts`、`readers/azure.ts`：加只发文字的结构化请求（截图沿用现有的图片请求）。
- [ ] `common/model.ts`：`recognizePolicyText`、`recognizeBenefits`，按 `settings.ocr_engine` 选一种。
- [ ] 页面：记保险的文件行标「规则读取 / 大模型读取」；`pages/benefit_recognize.tsx`（文字或截图，逐项勾选；「本店」「一年」之类标橙要确认）；「设置 › 截图识别」改名「识别方式」。
- 测试：合成文字的脱敏、schema 转换和核对；在 `XXYH_ROOT` 下保存真实请求的回复做回放，不在测试里联网。

## 1.8：记保养

开工前：用小熊 v307 备份里的 7 条保养记录和带 `maintain_id` 的费用核对字段，在本节细化。

- [ ] `sync/xxyh/types.ts`、`mapping.ts`：保养记录的读写映射，只写变化的字段；新保养记录照小熊 App 同时写一条 `maintain_id` 关联的费用。
- [ ] `sync/xxyh/ops.ts`：`put_maintain`、`delete_maintain`；`validateUpload` 检查保养记录条数。
- [ ] `common/types.ts`、`common/ledger.ts`：本机车辆的保养记录（`LocalRecord` 加入 `MaintenanceRecord`）。
- [ ] `pages/maintenance_form.tsx`：时间、里程、项目、门店、金额、使用权益、备注；记录页「+」菜单加「记保养」，保养行可以编辑和删除。
- 测试：真实备份往返不丢字段；合成备份上增、改、删保养记录后 `validateUpload` 通过，其余内容字节不变。
