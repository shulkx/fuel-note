# FuelNote Check：手机上的自动检查

开发用，不随油记发布。电脑通过手机上开的端口触发检查，结果和截图传回电脑，代替一部分手机验收。

## 它做什么

- **识别**（`recognize`）：从电脑上的采样服务取保单文件（`XXYH_ROOT/materials/insurance/`），在手机上用油记的 `readPolicyFiles`、`scanPolicyFile` 读出保单和交强险标志，电脑和 `XXYH_ROOT/out/insurance/expected.json` 逐项比较。读不出文字的 PDF 用这一页上的 WebView 截图识别。
- **记账**（`ledger`）：电脑按本机数据（`expected.json`、最新的小熊云备份）生成计划，手机在检查用的账本上用本机测试车做一遍并逐步核对：导入各年保险、补到小熊里已有的费用（保留原金额或改成合计）、改优惠、改付款日期、升级时挂交强险标志、续保提醒、删除、备份后恢复。
- **截图**（`shots`）：用检查用的账本渲染真实页面（保障页、保单详情、编辑表单、记录页的续保提醒），浅色、深色各一张，页面撑高后一张图看到整页。

## 不碰真实数据

- 启动时 `setDataRoot("FuelNoteCheck")`：账本、保单原件、小组件文件都在 App Group 的 `FuelNoteCheck/` 下；清空前会核对文件夹名。
- 不读写钥匙串、不同步小熊、不读车况；只向电脑上的采样服务取保单文件。
- 真实数据只在电脑的 `XXYH_ROOT` 里：计划由电脑生成后发给手机，结果和截图存到 `XXYH_ROOT/out/check/`，不进仓库。

## 用法

1. 电脑上开着开发服务器（`E:\scripting` 里 `npx scripting-cli start`）和采样服务（`npm run ocr-bridge`）。
2. `npm run check:install`：把这里的检查程序连同油记的代码复制到 `../FuelNote Check`。只写有变化的文件，先写临时文件再改名（直接覆盖时手机可能按旧内容重新运行）。
3. 第一次：手机上新建一个空脚本「FuelNote Check」，在开发服务器页面里选它，运行。之后改了代码再装一次，手机会自己用新代码重新运行（约 2 秒）。
4. 手机上这一页留在屏幕上、屏幕不锁。它向采样服务报到，地址写到 `XXYH_ROOT/out/check/phone.json`。
5. 电脑上：`XXYH_ROOT=E:/GitHub/xxyh npm run device-check`（或只跑一部分：`… device-check -- recognize ledger shots` 里选）。

改了 `runner.tsx` 后把 `STAMP` 加一，`/ping` 返回的 STAMP 就能确认手机跑的是新代码。

## 不能自动检查的

真的点按和手势（左滑删除、轻点徽章全屏显示、拨号、选文件、「识别扫描件」里的取消）、真实的小熊同步、标签栏，以及用户真实数据第一次升级时的结果，仍要在手机上看。
