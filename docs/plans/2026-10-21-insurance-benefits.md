# 油记 1.5、1.7–1.9：保险与权益 — 实施文档

- 设计：`docs/specs/2026-10-18-fuelnote-design.md` 第 20 节；界面草稿在画布「保险」「权益」「保障标签页」三行。
- 目标：1.5 保险，1.7 权益（含用大模型识别赠送和套餐），1.8 记保养，1.9 用大模型识别其他格式的保单。每期单独发布，前一期在手机上验收通过再开始下一期。
- 2026-10-22 用户调整：先做 1.6 油耗与费用分开（`docs/plans/2026-10-22-fuel-expense-split.md`，设计第 21 节），权益改为单独的「权益」标签，放到 1.7。手机验收的编号 143–150 给了 1.6，权益从 151 起。
- 技术栈不变：TypeScript + Scripting；Node 24 + tsx + node:test；tsc 用 `../../dts` 做类型检查。
- 约定沿用 `CLAUDE.md`：纯逻辑放 `common/`（不导入 `"scripting"`），Scripting 相关的放 `platform/`、`pages/`、`common/model.ts`；入口只从一个模块导入；泛型箭头函数写成函数声明；frame 不混写；可选属性不传 `undefined`。

## 状态（2026-10-21）

- 1.5.0-beta.9：用户确认没问题（2026-10-21）。第 128–142 项里能自动检查的已在手机上用 FuelNote Check 跑过（见下方「手机上的自动检查」），全部通过。等用户说「发版」后发布 1.5.0。
- 1.6 开工：先拿到用户往年送过的权益条目（见「1.6：权益与核销」开工前）。保单解析用三套文字核对过：电脑上 pdftotext 的 17 份、手机上 PDFKit 的 15 份、手机上截图识别的 2 份（2020 年人寿，PDFKit 取不出文字）逐项一致，3 张标志认出不是保单。17 份保单的保费、期间、险种都能自动填，不需要提前用大模型；大模型仍在 1.7，只用于驾乘意外险的明细和权益。

- 设计第 20 节已写；界面草稿已出，用户选定「保障」标签页的方案。
- 用户已确认：费用写实付、抵扣写进备注；保单自带的服务默认不追踪；指定门店；记保养放到最后一期，先在记费用里核销。
- 待确认：
  1. 1.7 保单「统一格式用规则，其他格式交给大模型」（设计 20.9 节），与加油截图「只用一种识别方式」不同。
  2. 用户提供往年送过的权益条目（1.6 开工前，用来检验金额型、次数型、套餐、门店、单次上限够不够用，并替换草稿里的示例）。
  3. 「保障」这个标签名。
- 2021 年平安的保单（2026-10-22）：平安只能给历史保单的抄件，用户导入后两份都认成「其他」。规则已改（见下方「平安历史保单的抄件」），手机上 PDFKit 的文字和 FuelNote Check 的识别都已核对。

## 手机上的自动检查（2026-10-21 起）

用户提出每次手动验收太繁琐。`tools/check`（手机端，数据在单独的 `FuelNoteCheck` 文件夹）和 `tools/device_check.ts`（电脑端），用法见 `tools/check/README.md`。验证过：电脑能连上手机开的端口；`screenshotRef` 能截列表和表单（浅色、深色，页面撑高后一张图看到整页）；能自己弹出页面、截图、关掉；开发服务器改了文件后手机约 2 秒用新代码重新运行（文件要先写临时文件再改名）。

第 128–142 项的分工：

| 自动 | 项目 |
|---|---|
| 识别（真实文件 vs expected.json） | 129、139、142 的识别部分（21 个文件，其中 4 个截图识别、1 张图片） |
| 记账（检查用的账本，39 项） | 130–132、135、136、138、141、142 的升级 |
| 截图（我看） | 128（标签栏除外）、133、134、137、142 的界面 |

仍要用户在手机上看的：标签栏 4 个；点按和手势（左滑删除、轻点徽章全屏显示、「报案」拨号、「保单 N 份」打开原件、选文件、「识别扫描件」里取消）；真实的小熊同步（补充保单后小熊里那笔不变或跟着改）；用户真实数据第一次升级时标志自动挂上。

第一次跑出的问题（1.5.0-beta.8 修好）：徽章里的年份太大，挨着左右的点；编辑时保单按存的顺序排（驾乘意外险在交强险前面）；详情里「平安车主尊享保障」的保单号折成两行。截图本身的限制：页面顶部的玻璃按钮偶尔截不到（等久一点就有）。

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
| 1.6 | 油耗与费用分开（另一份实施文档） | 1.5 |
| 1.7 | 权益：「权益」标签、用大模型识别赠送和套餐、我的门店、记费用时核销、单独记使用、到期提醒、统计的权益抵扣；脱敏 | 1.6；用户的往年权益条目（已拿到） |
| 1.8 | 记保养：表单、小熊保养记录的读写、本机保养记录、记保养时核销 | 1.7 |
| 1.9 | 大模型识别非统一格式的保单 | 1.5；待确认第 1 项 |

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
- [x] 采样结果（2026-10-21，用户在手机上跑完 Probe）。PDFKit 取出的文字和电脑上 pdftotext 的差别：
  - 明细一个险种一行（「机动车损失保险 180000.00 — 3000.00」），名称太长时折到下一行（「…代为送检服务」「特约条款 1 次 — —」）；pdftotext 则是名称和数值各占一行，2022 年平安的四项服务按列排在一起。规则两种都认：每行先把行末的数值拆出来。
  - 标签挤在一起，值排在后面：「确认码：保险单号：」后面先是确认码再是保单号，「保单号：验真码：」，「签单日期：」和日期之间隔着公司名称、邮编、电话。保单号取标签后第一个数字开头、19–24 位的号码；签单日期取标签后 200 字内的第一个日期。
  - 平安 2022 年交强险的车船税大写金额排在「合计（人民币大写）」前面，「当年应缴」的金额在「￥」前面。
  - 2020 年人寿的两份 PDFKit 取不出任何文字（pdftotext 可以），1.5.0-beta.2 提示「PDF 里读不出文字，请手动添加」；1.5.0-beta.3 改为截图后在本机识别（见下）。用户找到的当年原件（2020 年 5 月存的，PDF 1.3）内容相同，PDFKit 同样取不出文字。原因：两版都由同一个电子签章软件（Dj PdfCreater）生成，字体的 ToUnicode 映射里用了 ToUnicode 不允许的 `begincidrange`，pdftotext 容忍，PDFKit 不认。
  - 1.5.0-beta.1 用的是只按 pdftotext 写的规则，手机上商业险的保额、保费都没读出；1.5.0-beta.2 修正。
- 验证：手机上跑 `FuelNote Probe`，20 个 PDF 都有结果。把 PDFKit 与 pdftotext 在明细排列上的差别（按行还是按列、期间是否被拆开）记到本文的这一节，作为解析规则的依据。

### 平安历史保单的抄件（2026-10-22）

用户从平安拿到 2021 年的两份保单，是历史保单的抄件（「本抄件为原始合同影印内容」），导入后都认成「其他」。和 2022 年平安的正式保单是同一套版式，用电脑上 pdftotext 取出的文字对比，差别只有这几处：

- 标题带「(抄件)」；交强险写「机动车交通事故责任强制保险」，少一个「单」；商业险前面带「中国平安」。
- 商业险明细的表头是「投保险别」「保费小计（元）」「保费合计(元)」；正文「依照承保险种及其对应条款」排在明细前面；金额带「元」（「317466.60元」）；明细后面一行「车损险每次事故绝对免赔额 0元/次」。
- 商业险的「保险费合计」后面没有冒号，大写金额折成两行。

- [x] `common/policy_text.ts`：标题去掉「(抄件)」、改回正式保单的标题；明细从「承保险种」（不算正文里的「承保险种及…」「承保险种对应…」）或「投保险别」开始；金额可以带「元」；表头加上「保费小计」「保费合计」「每次事故绝对免赔额」；「保险费合计」的冒号可有可无；大写金额去掉空白再读。
- [x] 两份复制到 `XXYH_ROOT/materials/insurance/2021年01月07日-2022年01月06日.中国平安/`，期望值按原件补进 `expected.json`，电脑上的文字补进 `pdftotext.jsonl`。
- [x] 手机上 FuelNote Check 识别：交强险一次通过；商业险的 PDFKit 文字和电脑上的不同，又改了两处：
  - 分组名「附加机动车增值服务特约条款」单独一格、折成两行，夹在「代为送检」和「代为驾驶」之间：认不出的名称后面紧跟一个认得出的险种时，接到那一项前面（之前当成了一项，「代为驾驶」的次数配错）。
  - 竖排的「特别约定」四个字夹在「保险费合计」和「RMB…」之间：两者之间允许 12 个以内的非数字字符（之前不含税保费、税额没读出）。
- [x] 测试：合成的抄件（电脑上的版式；手机上的版式：一个险种一行、「(抄件)」另起一行、分组名折行、竖排的「特别约定」）；真实保单在三套文字上 19 份逐项一致。
- [x] `tools/check`：识别时把 PDFKit 取出的原文一起传回，电脑把 `pdfkit.jsonl` 里还没有的补上，新加的保单不用再跑 Probe（STAMP 16）。

### 1.5.0-beta.7：截图识别读成繁体、日文写法的字

用户在手机上跑了 Probe（2026-10-21）：`2026.强制保险标志.JPG` 认成整份标志，保单号（「保险单号」标签后的，不是条码号）和期间都对；2020 年人寿交强险截前 2 页，第 2 页认成标志、与第 1 页的保单对上。但这次第 1 页的「签单日期」读成了「签単日期」（日文写法的「単」），签单日期没读出；早先的结果里也有「責任限额」「免賠率」「滯纳金」「保險期间」。

- [x] `common/policy_text.ts`：`ocrPageText` 排成行时把标签里用到的字的繁体、日文写法换回简体（只换截图识别的文字）。
- [x] 测试：合成的「签単日期」「保險期間」「責任限額」；`pdf_ocr.jsonl` 里 2020 年交强险两页、商业险、2026 年标志 JPG 逐项一致。

### 1.5.0-beta.6：交强险标志

用户提出（2026-10-21）：交强险标志有的在保单 PDF 里、有的是单独的 PDF、有的是 JPG，应该统一处理，还可以用来美化界面。稿子在画布「交强险标志」一行（用户选定：PDF 和图片都支持；徽章按到期时间变色；当前保单下面不加单独的按钮）。

- [x] `common/policy_text.ts`：`isMarkPage`（印着「强制保险标志」，或很短且有保单号和期间）、`parseMark`（有「保险单号」标签时取标签后的号码）、`readPolicyPages`（一个文件的各页 → 保单和标志，整份是标志时 page 为 null）、`markMatch`（保单号相同，读错时期间相同）。
- [x] `common/insurance.ts`：`markLook`（到期年月、有效 / 45 天内 / 已到期）、`yearMark`、`isImageFile`、`fileCountText`；`yearFiles` 带上标志；`upgradeYearMarks`（升级前存进来的标志，读写由调用方给）。
- [x] `common/types.ts`：`Policy.mark?`、`Settings.insurance_marks_checked?`。
- [x] `platform/pdf.ts` 的 `pdfPageData`、`platform/storage.ts` 的 `savePolicyData`、`platform/vision.ts` 的 `recognizeImageFile`；`common/model.ts`：`readPolicyFiles` 读图片、读出标志，`savePolicyMark`，`upgradeInsuranceMarks`（打开油记时做一次，做完再开始同步）。
- [x] 页面：`pages/insurance_parts.tsx` 的 `MarkBadge`；保障页当前保单左边是徽章；详情「保单」一组交强险下面是标志、原件计数分 PDF 和图片；记保险可以选图片，标志一行、「含标志」、交强险一组的「交强险标志」、还没对上的标志。
- [x] 测试：合成的标志页（人寿版式、图片识别版式、交强险保单第 2 页）、不是标志的短页、对应规则；真实数据里 3 份标志 PDF 和 2020、2024 年的标志页（pdftotext、PDFKit）；徽章的年月和颜色、原件计数、升级。
- [x] `tools/ocr_bridge.mjs`、`tools/probe/index.tsx`：保单文件夹里的图片（`2026.强制保险标志.JPG`）直接识别；读不出文字的 PDF 截前 3 页（之前只截第 1 页）。结果存到 `pdf_ocr.jsonl`（带 `page`），测试按文件、页拼起来核对。

### 1.5.0-beta.5：与小熊已有费用的对应只决定一次

用户指出（2026-10-21）：补上保单后再编辑，表单里还能选「新记一笔」或换一笔费用，太过头。核对用户小熊里已有的几笔保险费用：有的与保单合计相同；有的备注写着返现（补上保单后填进优惠就对上）；有的比合计少的正好是交强险（当年只记了商业险和车船税），要保留原金额。所以金额的二选一要留，但和关联一样只在第一次问。

- [x] `pages/insurance_form.tsx`：去掉「记到」选择器。补充保单、编辑时显示「对应费用」；新记（或编辑时那笔已删）有 45 天内可补的费用时显示开关「补到已有的费用」，默认打开，付款日期改用那笔的日期；第一次补到、金额不同时才问「保留原金额 / 改成保单合计」，比合计少时提示填进优惠；编辑时按打开时金额是否相同定下处理方式。
- [x] `common/ledger.ts`：`putInsurance` 保留原金额时也跟着付款日期改费用的日期（金额、备注不动）；`linkInsuranceExpenses` 按时间和类别找回，同一时刻有几笔时优先金额等于合计的。
- [x] 测试：保留原金额时改日期（本机车辆改记录；小熊车辆生成操作、按新日期找回 id、上传前检查通过）。

### 1.5.0-beta.4：没认出是保单的 PDF 作为附件保存

用户提出（2026-10-21）：交强险标志这类没认出是保单的 PDF，也应该能存进来，而不是拒绝。

- [x] `common/types.ts`：`InsuranceYear.attachments?: string[]`（原件的相对路径，没有时不写）。
- [x] `common/insurance.ts`：`yearFiles(y)`（保单原件再加附件）；`common/model.ts` 的 `saveInsurance` 按它删掉编辑时去掉的文件；`scanPolicyFile` 截图后没认出时不算出错（与有文字的 PDF 一样）。
- [x] `pages/insurance_form.tsx`：没认出的、打不开的、取消识别的都加为附件（写原因），左滑删除；同名文件再选一次时替换；保存时复制原件。不再弹出「有文件没有读入」。
- [x] `pages/insurance_detail.tsx`：「查看保单原件」连附件一起打开。
- [x] 测试：`yearFiles`。

### 1.5.0-beta.3：读不出文字的 PDF 截图识别

用户希望保单都能自动填（2026-10-21）。先在手机上试：Probe 把 2020 年的两份下载版和两份原件显示在 320×453 的 WebView 里，`takeSnapshot({ snapshotWidth: 1240 })` 截图（3720×5267 像素，字很清楚），Vision 识别约 1 秒。识别出的文字块按列排，直接交给规则时商业险的明细配错；按位置排成行（小票的 `ocrLines`）后两份的保费、期间、险种、保单号、签单日期、车船税都与 expected.json 一致，只差两处：交强险的车架号把 1、0 读成 I、O，浮动比率后的「%」没读出。结论：读不出文字的 PDF 在本机截图识别，不用把图片发给大模型。

- [x] `tools/probe/index.tsx`「读不出文字的 PDF：截图再识别」、`tools/ocr_bridge.mjs` 的 `POST /pdf_ocr`（存到 `out/insurance/pdf_ocr.jsonl`）和 `POST /pdf_image`（截图存到 `out/insurance/pdf_images/`）。
- [x] `common/policy_text.ts`：`ocrPageText(blocks)` 按位置排成行；`parseVin` 在「车辆识别代码」「车架号」「VIN」后面把 I、O、Q 纠正成 1、0、0；`parseFloatRate` 允许没有「%」（数字在行末）。
- [x] `platform/pdf.ts`：`singlePagePdfs(path)`（前 3 页拆成单页 PDF）、`snapshotPdfPage(web, page)`（显示后等 1.5 秒截图，失败时再试 3 次）；`platform/vision.ts`：`recognizeBlocks(image)`（小票和保单共用）。
- [x] `common/model.ts`：`PickedPolicy.textless`；`scanPolicyFile(picked, web, onPage)`。
- [x] `pages/policy_scan.tsx`「识别扫描件」：文件名、正在识别的那一页（WebView）、进度；识别完自动关闭，可以取消。`pages/insurance_form.tsx`：选的 PDF 里有读不出文字的就弹出它；文件行标「扫描件」。
- [x] 测试：合成的按列打乱的文字块（排成行、读出明细、纠正车架号）；丢了「%」的浮动比率；`XXYH_ROOT` 下核对 `pdf_ocr.jsonl` 的两份。

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
131. 补小熊里已经记了金额的那一年：从「只有金额」点「补充保单」，「费用」一组显示「对应费用」（不能改），保存后不新增费用，金额不变。
132. 补小熊里金额和保单合计不同的那一年：提示二选一；选「保留原金额」后费用不变。
133. 补其余年份：商业险晚一个月起保的那年，年份仍按交强险的起保年算。历年列表每年一行；只在小熊里记了金额、没有保单的那年在「只有金额」里，没有误报「没有记录」。
134. 保单详情（最近一年）：比上一年的变化、车损险的「去年」金额、交强险「浮动 · 去年」与 expected.json 算出的一致；保单号能复制。
135. 续保提醒：用一辆本机测试车记一份 20 天后到期的保险，记录页出现提醒；点「×」后不再出现；记下一年后也不再出现。
136. 删除：在记录页删除保险费用，提示保单明细一起删除；在详情里删除时可以选只删明细。删除后原件也删掉。
137. 深色模式下保障页、详情、表单都看得清。
138. 备份后恢复，保险都在；备份页写明原件不在备份里。

139. 记保险 → 选 2020 年人寿的两份 PDF（读不出文字）：弹出「识别扫描件」，逐页显示后自动关闭；两份都标「扫描件」，交强险的保费、浮动比率、车船税和商业险的三个险种与 expected.json 一致，商业险「合计相符」。识别时点「取消」，这两份作为附件，写「附件 · 没有识别（已取消）」。

140. 选一份既不是保单也不是交强险标志的 PDF（例如条款）：那一行写「附件 · 没认出保单内容」，不弹出「有文件没有读入」；保存后详情的「查看保单原件」能翻到它；编辑时左滑删掉附件，保存后原件也删掉。（1.5.0-beta.4 时这里用的是交强险标志，1.5.0-beta.6 起标志挂到交强险上，见第 142 项。）

141. 与小熊已有费用的对应只问一次：
    - 编辑已经补到费用的一年：「费用」一组只有「对应费用」，没有「新记一笔」，也不再问金额。
    - 2022 年（金额相符）改一下优惠：保存后小熊里那笔跟着变；改回来再保存，恢复原样。
    - 2020 年（保留原金额）：编辑时不再问金额；改付款日期后，小熊里那笔的日期跟着改、金额不变，保障页这一年的关联还在。
    - 用「+」记一年小熊里已经记过的保险：出现「补到已有的费用」开关，打开时付款日期是那笔的日期；关掉后保存会新记一笔。

142. 交强险标志：
    - 升级后打开油记：已存的 2024 年（交强险 PDF 第 2 页）和存成附件的标志 PDF 自动挂到交强险上，详情里交强险下面出现「交强险标志」；2020 年读不出文字，编辑那一年重新选交强险 PDF 后出现。
    - 编辑 2026 年，选 `2026.强制保险标志.JPG`：一行写「交强险标志 · 2027 年 1 月到期 · 保单号相符」，交强险一组多一行「交强险标志」；保存后详情里「查看保单原件」写「3 份 PDF、1 张图片」。
    - 保障页当前保单左边是绿色徽章「2027 / 1月」，1 点钟方向一个孔；轻点全屏显示标志；卡片下面一行提示。深色模式下孔的颜色和卡片一样。
    - 只选标志、不选交强险：标志一行标橙「还没有对应的交强险」，保存后在附件里。

用户确认后发布 1.5.0。

## 1.7：权益与核销

方向见设计 20.7 节开头（画布第三轮、第四轮）。开工前：按它改写 20.7 节的数据结构（按来源分组、余额和次数、面值和价值），在本节细化到函数和测试用例；大模型识别权益的部分从原来的 1.7 移到这里。

- [ ] `common/types.ts`：`Store`、`Benefit`、`Redemption`；`LedgerFile.stores?`、`benefits?`、`redemptions?`、`record_meta?`。
- [ ] `common/benefits.ts`（纯）：剩余、是否过期、`usableBenefits(benefits, { storeId, categoryId, ts })`、默认抵扣 `min(余额, 金额, 每次上限)`、`expiringBenefits(now, 30)`、保单增值服务生成权益（`tracked: false`）、从费用备注最后一行和保单销售渠道找门店。
- [ ] `common/ledger.ts`：保存费用时一起写核销和 `record_meta`（编辑时替换、删除时撤销）；小熊车辆的费用金额写实付、备注加抵扣和门店；购买套餐时记一笔费用。
- [ ] 页面：「权益」标签；`pages/benefit_detail.tsx`；`pages/benefit_form.tsx`；`pages/store_picker.tsx`（我的门店、高德搜索汽车销售和维修地点、新建）；`pages/expense_form.tsx` 加门店、使用权益、实付；`pages/insurance_form.tsx` 加「赠送」一组；记录页的到期提醒并进续保提醒；统计页的权益抵扣。
- 测试：`tests/benefits.test.ts`；`tests/ledger.test.ts` 的核销、撤销、小熊备注；`tests/backup.test.ts`。
- 手机上的验收从 151 开始编号，开工时补上。

## 1.9：大模型识别保单（识别权益已并入 1.7）

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
