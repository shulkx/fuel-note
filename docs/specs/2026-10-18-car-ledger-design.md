# 车账本（Car Ledger）— 设计文档

- 日期：2026-10-18
- 状态：v1 实施中
- 前身：xxyh 仓库的油猴脚本「记加油」（`E:\GitHub\xxyh\userscript`，记录功能冻结在 v0.3.7）

## 1. 定位

车账本是在 Scripting 里独立运行的用车账本。

- **不需要任何账号**：手动记加油和其他费用，自动算油耗、花费。
- **可选连接小熊油耗**：把小熊的云备份当作同步后端，和小熊官方 App、网页版共用一份数据。
- **可选连接车辆数据服务**：先支持沃尔沃（中国），读取行程来填里程、识别加油停车、推荐油站。按「车辆数据提供方」接口设计，以后可以接入其他品牌。

三个能力互相独立：只用本机、只连小熊、只连沃尔沃、全部都连都可以。

### v1 不做

截图识别、编辑保养记录、充电记录、收入、提醒、快捷指令入口、多个小熊账号、自建 iCloud 同步。保养记录 v1 只同步并显示，不能编辑。路线图见第 14 节。

## 2. 用户场景

1. **只用本机**：新建车辆 → 记加油（时间、里程、单价 / 升数 / 金额任填两项、实付、标号、加满、油灯、上次漏记、油站、备注）→ 列表显示每次油耗，统计页显示平均油耗和花费。
2. **连接小熊油耗**：粘贴凭据 → 读取小熊里的车辆和全部历史 → 之后在车账本里新增、修改、删除，都会上传为新的云备份版本；打开车账本时拉取官方 App、网页版的修改。
3. **连接沃尔沃**：粘贴 refresh token → 选择车辆（VIN）→ 记加油时点「从行程选择」：列出最近 7 天的停车，加油停车排在前面并带出油站 → 一次填好里程、时间和油站。
4. **桌面小组件**：显示最近油耗、平均油耗、上次加油、本月花费；点小组件打开新增加油。

## 3. 总体结构

```
入口      index.tsx（App）   widget.tsx（小组件）
            │  只从 common/model 导入（打包器限制，见 9.4）
页面      pages/*.tsx（Scripting 的 SwiftUI 组件）
            │
应用层    common/model.ts —— 读写数据、组装列表和统计、调度同步与提供方
            │
领域      common/{types,fuel,form,stats,time,ids,geo,hash}.ts         纯函数，Node 可测
集成      sync/xxyh/{api,mapping,ops,sync}.ts                         纯逻辑 + 注入的 HTTP
          providers/{types,registry,volvo_cn}.ts
          stations/{match,search}.ts、common/stops.ts
平台适配  platform/{storage,secrets,http}.ts —— 唯一使用 Scripting 全局 API（FileManager、Keychain、fetch）的地方
```

约束：

- 领域层和集成层不引用 Scripting 的全局对象，HTTP 通过 `Http` 函数注入。这样核心逻辑可以在电脑上用 Node 测试（第 13 节）。
- 坐标在应用内部一律用 **WGS-84**。各数据源（沃尔沃 GCJ-02、高德 GCJ-02、小熊油站 BD-09 / WGS-84）在边界处转换。
- 时间一律用毫秒时间戳；显示用设备时区。

## 4. 数据模型

```ts
type Vehicle = {
  id: string                 // 本机生成
  name: string
  default_grade: number | null
  created_ts: number
  xxyh_car: string | null    // 关联的小熊车辆 uuid；null = 只在本机
  provider: { id: ProviderId; vehicle_id: string; name: string } | null  // 关联的车辆数据（如沃尔沃 VIN）
}

type FuelRecord = {
  kind: "fuel"; id: string; vehicle_id: string
  ts: number                 // 加油时间
  odometer: number           // 表显里程，整数公里
  liters: number             // 加油量（升）
  price: number              // 机显单价（元/升）
  amount: number             // 机显金额（元）
  paid: number               // 实付金额（元）
  grade: number | null       // 92 / 95 / 98 / 0（柴油）……
  full: boolean              // 加满跳枪
  light_on: boolean          // 加油前油灯亮
  missed_before: boolean     // 上次加油漏记
  station_id: string | null
  remark: string
}

type ExpenseRecord = {
  kind: "expense"; id: string; vehicle_id: string
  ts: number; category_id: number; amount: number; remark: string
}

type MaintenanceRecord = {   // v1 只读，来自小熊
  kind: "maintenance"; id: string; vehicle_id: string
  ts: number; odometer: number; items: string; amount: number; remark: string
}

type Station = {             // 油站
  id: string; name: string; address: string
  province: string; city: string; district: string
  lng: number; lat: number   // WGS-84
}

type ExpenseCategory = { id: number; name: string; description: string }
```

视图层用 `LedgerRecord = FuelRecord | ExpenseRecord | MaintenanceRecord`，额外带两个字段：

- `origin: "local" | "xxyh"`：来自本机还是小熊。
- `pending: boolean`：有没有还没上传的修改。

费用类别沿用小熊的编号：行车费 100000、维修保养 100001、保险和交通规费 100002、其他 100003。这样本机车辆以后关联小熊时不用换编号。

## 5. 存储

全部放在 `FileManager.appGroupDocumentsDirectory/CarLedger/`，小组件也能读到：

| 文件 | 内容 |
|---|---|
| `ledger.json` | `schema_version`、车辆、**本机车辆**的记录、本机油站、本机费用类别、设置 |
| `xxyh.json` | 小熊同步状态：基准版本号、基准备份（完整 JSON）、待上传操作、上次拉取 / 上传时间、上次错误 |
| `xxyh_snapshots/v<N>.json` | 最近 5 个下载或上传过的小熊版本，出问题时可以找回 |

凭据放 Keychain（第 12 节），不进文件。

写文件统一先写临时文件再改名，避免写一半断电或崩溃把文件写坏。`schema_version` 不对时不覆盖原文件，提示用户并备份原文件。

## 6. 油耗与统计

### 6.1 每次油耗（跳枪法）

按里程排序同一辆车的加油记录。

- 从一次**加满**到下一次**加满**算一段。
- 这一段的油耗 = 这一段里每次加油的升数之和（不含起点那次，含终点）÷ 两次加满之间的里程 × 100。
- 结果显示在终点那条记录上。
- 段内任意一条记录标了「上次漏记」，这一段就不计算。
- 第一次加满、终点之前没加满的记录：都不显示油耗。

小熊把同一个数字存在**起点**记录的 `consumption` 字段里，网页版显示在终点上，和我们一致。我们的结果和小熊的 `consumption` 要能对上（第 13 节有测试）。

### 6.2 统计

- 平均油耗 = 所有有效分段的升数之和 ÷ 里程之和 × 100。
- 最近油耗：最近一个有效分段的结果。
- 加油花费按实付算；其他费用按金额算；保养按花费算。
- 每公里花费 = 时间范围内的全部花费 ÷ 里程跨度（第一条到最后一条记录的里程差）。
- 统计范围可选：全部、今年、近 12 个月。

### 6.3 录入核对

- 单价、升数、机显金额三项任意填两项，自动算出第三项；三项都填时检查是否满足 单价 × 升数 ≈ 金额，允许误差 单价 × 0.01 + 0.01。
- 实付默认等于机显金额；实付大于机显金额时提示。
- 里程必须大于上一条、小于下一条记录。
- 算出的本段油耗不在 4–25 L/100km 时提示，确认后仍可保存。

## 7. 小熊油耗同步

### 7.1 小熊的数据

小熊的云备份是**一个完整的 JSON 文档**，每次保存都上传为一个新版本（`backupVersion` 递增）。主要内容：

- `cars[]`：每辆车有 `fuelRecords`、`expenseRecords`、`maintainRecords`、`incomeRecords`、`reminderRecords`。
- `myStations.stations[]`：我的油站，所有车共用。
- `expenseTypes`、`incomeTypes`：费用和收入的类别。

接口：

- `account_sync.php`：查最新版本号。
- `backup.php?a=rjsondatabyversion`：下载指定版本。
- `backup.php` POST `a=bjsondata`：上传为新版本。

签名用的 `key` 与 iOS App 相同：`md5("051f51b60f2611e491910800200c9a66")`。

### 7.2 原则：关联的车辆以小熊为准

关联了小熊的车辆，本机**不单独保存记录**。显示的数据是计算出来的：

> 显示的数据 = 映射（把待上传操作依次应用到基准备份上的结果）

- **基准备份**：最近一次下载或上传的完整 JSON。
- **待上传操作**：用户在车账本里的新增、修改、删除，按顺序记下来。
- **拉取**：云端版本号变了，就下载新版本作为基准，再把待上传操作重新应用一遍。
- **上传**：先下载云端最新版本，把待上传操作应用上去，整份上传；成功后上传的文档就是新的基准，并清空操作。

这样不需要做三方合并：云端是唯一的真相，本机只多出一串还没送到云端的修改。即使官方 App 或网页版同时修改了数据，上传前也总是在最新版本上应用修改。

### 7.3 映射

| 车账本 | 小熊加油记录 | 说明 |
|---|---|---|
| ts | date | |
| odometer | odometer | 整数 |
| liters | fueledLiter | 旧记录 `fueledLiter` 为 0 时用 `yuan / price` |
| price / amount / paid | price / yuan / payYuan | `payYuan` 缺失或为 0 时 paid = amount |
| grade | type | |
| full / light_on / missed_before | gassup / lightOn / forget | |
| station_id | stationId | 空字符串 = 无 |
| remark | remark | |

- 费用：ts = date，category_id = type，amount = expense，remark = description。
- 保养（只读）：ts = dateTime，odometer = currentMileage，items = maintains + customMaintains，amount = spend，remark = message。
- 油站：`coordinate_type == "wgs84"` 时直接用坐标；没有坐标类型的是百度坐标（BD-09），转成 WGS-84。
- 只处理 `replenishType == 1`（加油）的记录。充电记录和收入、提醒原样保留，不显示也不改动。

**记录标识**：小熊的 `wc_id` 在用户恢复备份后会被重新编号，所以用记录时间 `date` 作为标识。

- 车账本里的 id 形如 `x:<车辆uuid>:f:<date>`，费用是 `:e:`，保养是 `:m:`。
- 同一辆车出现时间完全相同的记录时，后面的加序号 `#2`、`#3`。

**修改时保留原有写法**：更新一条记录时，只写入值确实变化的字段，其他字段保持原样（包括车账本不认识的字段）。例如旧记录 `fueledLiter` 为 0，用户只改了备注，就不会把算出来的升数写进去。

新记录的格式与油猴脚本 v0.3.7 一致，它已经在官方 App 和网页版上验证过：

- `wc_id` = 当前最大值 + 1；
- `carId` 沿用该车已有记录的写法；
- 其余字段取默认值，`consumption` 为 0，由 App 自己计算。

新油站使用 App「自定义」站点的格式：

- `src = customized`，`coordinate_type = wgs84`；
- `id = ((纬度×1e6 + 9e7) << 30) + 经度×1e6 + 1.8e8`。

### 7.4 操作

```ts
type XxyhOp =
  | { type: "put_fuel"; car: string; key: number | null; data: FuelData; station: Station | null; at: number }
  | { type: "delete_fuel"; car: string; key: number; at: number }
  | { type: "put_expense"; car: string; key: number | null; data: ExpenseData; at: number }
  | { type: "delete_expense"; car: string; key: number; at: number }
```

`key` 是被修改记录**修改前**的 `date`，`null` 表示新增。`station` 是这次要新建的油站，引用已有油站时为 `null`。

应用规则：

| 操作 | 找到对应记录 | 找不到 |
|---|---|---|
| 新增（key = null） | 已有完全相同 `date` 的记录：按更新处理（上次上传成功但没收到回应的情况） | 插入新记录 |
| 修改 | 只写变化的字段；`date` 可以改 | **冲突**：云端已经删除或修改了这条记录 |
| 删除 | 删除 | 视为已删除，不算冲突 |

- 新油站按 `id` 去重；引用已有油站时，把油站的 `timeStamp` 更新为这次加油时间。
- 有冲突的操作在上传时丢弃，并告诉用户哪几条没能应用；在本机显示时也会跳过它们。
- 新增后还没上传就修改或删除：这次修改的 key 就是新增记录的 date，按顺序应用，结果自然正确，不需要特殊处理。

### 7.5 什么时候同步

| 时机 | 动作 |
|---|---|
| 打开 App、回到前台（距上次 ≥ 2 分钟） | 拉取；有待上传操作且开了「自动上传」时上传 |
| 保存一条修改后 | 开了「自动上传」时立即上传（默认开） |
| 列表下拉刷新 / 设置页「立即同步」 | 拉取 + 上传 |
| 小组件 | 不同步，只读本机文件 |

上传失败时保留操作，下次再试；界面上显示「N 条待上传」。

### 7.6 上传前检查

满足以下全部条件才上传，否则放弃这次上传并报错：

- 油站 id 不重复；记录引用的油站都存在。
- 每辆车的 `wc_id` 不重复。
- 车辆数量和下载的版本一致。
- 每辆车的加油记录数 = 下载版本的条数 + 新增 − 删除。

每次下载和上传的版本都存进 `xxyh_snapshots/`，只留最近 5 个。

### 7.7 关联与解除

- **连接**：校验凭据 → 下载最新版本 → 列出小熊里的车辆。小熊里每辆还没关联的车，都新建一辆车账本车辆并关联。
- **把本机车辆关联到小熊车辆**：本机车辆的记录全部变成新增操作，时间相同的会跳过；预览条数后上传；成功后清掉本机副本。
- **断开**：把当前显示的数据（含待上传修改）复制成本机记录和本机油站，车辆变回只在本机。有待上传操作时先提示。

### 7.8 与官方 App、网页版同时使用

- 官方 App 登录时会自动上传它本地的整份数据。如果它本地是旧数据，上传后会覆盖车账本的修改。车账本发现版本变化后会拉取，但被覆盖掉的记录不会自动回来。
- 网页版内存里也可能是旧数据：在网页版编辑之前要先刷新。
- 建议：用车账本记录，用网页版只浏览；官方 App 不再登录或已卸载。

## 8. 车辆数据提供方（可扩展）

### 8.1 接口

```ts
type ProviderId = "volvo_cn"   // 以后在这里加

type Trip = {
  id: string
  start_ts: number; end_ts: number
  start_odometer_km: number | null; end_odometer_km: number
  distance_km: number | null; fuel_l: number | null
  start: Place | null; end: Place | null    // WGS-84
}
type Place = { lng: number; lat: number; address: string; city: string; district: string }

type VehicleDataProvider = {
  id: ProviderId
  name: string                         // 「沃尔沃（中国）」
  description: string
  credentialFields: CredentialField[]  // 设置页按这个生成输入框
  normalizeCredential(input: Record<string, string>): Record<string, string>  // 例如从 BoxJS JSON 里取出 refreshToken
  listVehicles(ctx: ProviderContext, cred: Record<string, string>): Promise<RemoteVehicle[]>  // 同时用来校验凭据
  fetchTrips(ctx: ProviderContext, cred: Record<string, string>, vehicleId: string, range: { from: number; to: number }): Promise<Trip[]>
}
type ProviderContext = { http: Http; now: () => number }
```

- `providers/registry.ts` 列出所有提供方；设置页、记录页只通过注册表和接口使用它们，不认识具体品牌。
- 凭据整体以 JSON 存在 Keychain：`car_ledger.provider.<id>`。
- 会话令牌只缓存在内存里，App 每次启动重新换一次。

### 8.2 沃尔沃（中国）

- **换会话**：签名 GET `apigateway.digitalvolvo.com/app/iam/api/v1/refreshToken`，签名方式 v587sign（HMAC-SHA256）。得到 accessToken、jwtToken、globalAccessToken，有效期 30 分钟。refresh token 不会轮换，长期有效。
- **车辆**：签名 GET `/app/account/vehicles/api/v1/owner/listBindCar`，取所有 `vinCode`。
- **行程**：GET `cepmobtoken.lbs.prod.c3.volvocars.com.cn/journallog-trip-api/vehicles/{VIN}/trips?quantity=0&startDate&stopDate&tripsWithoutLocations=INCLUDE`，带 `Bearer globalAccessToken`。
  - 里程和距离以米为单位，坐标是 GCJ-02；
  - 只保留最近 400 天。
- 凭据可以粘贴 BoxJS 的 `volvo_auth`（取其中的 `refreshToken` 字段），也可以只粘贴 refresh token。

### 8.3 加油停车识别（与品牌无关）

输入是行程、我的油站、可选的附近油站搜索。来自油猴脚本 v0.2.0，规则与参数不变：

- 每段行程的终点是一次停车，停留时长 = 下一段行程开始 − 这段结束。
- 离我的油站 80 m 以内、停留不超过 45 分钟 → 加油停车，油站就是这个已有油站。
- 否则停留不超过 30 分钟时，搜索附近 200 m 的加油站：最近的一个在 60 m 以内就算加油停车。搜到的点离已有油站 80 m 以内时，用已有油站。
- 每次最多为 12 个停车点做附近搜索，从最近的停车往前查。
- 停车结束后 −15 分钟到 +3 小时内已经有加油记录 → 标为「已记录」。

用 2024-12 至 2026-10 的 916 段行程回放验证过：

- 74 条加油记录中有 73 条能找到对应的加油停车，没有误判。
- 加油后回家再记（不知道支付时间），选择「最近一次未记录的加油停车」：74 条中选对 72 条。

### 8.4 接入新品牌

1. 新建 `providers/<brand>.ts`，实现 `VehicleDataProvider`。坐标转成 WGS-84，里程转成公里。
2. 在 `providers/registry.ts` 里登记。
3. 在 `tests/` 加映射测试（用合成数据，不提交真实行程）。

界面和停车识别都不用改。只提供里程、不提供行程的品牌，可以返回只有终点、没有坐标的行程：停车识别会跳过它们，「从行程选择」照样可以用来填里程。

## 9. 油站

### 9.1 来源

- 车辆关联了小熊：用小熊的「我的油站」。
- 只在本机：用 `ledger.json` 里的油站。

### 9.2 附近搜索

在设置里选择，默认「自动」：

- 有高德 Web 服务 key：用高德（`/v5/place/around`，类型 010100）。
- 没有 key 但连了小熊：用小熊的附近油站（`geo/index.php?a=aroundpois`）。
- 都没有：只在我的油站里找。

### 9.3 选择油站

页面分三部分：

- 附近：以选中的停车点为中心，3 km 内我的油站加上搜索结果，按距离排序。
- 我的油站：按最近使用排序，可以搜索。
- 关键字搜索：在我的油站里按名称搜，有高德 key 时同时搜高德。

选了搜索结果，保存记录时就新建这个油站。

### 9.4 打包器限制

scripting-cli 的打包器在入口文件同时从多个 `common/` 模块导入时，可能出现 `(0, x.fn) is not a function`。所以：

- `index.tsx`、`widget.tsx` 只从 `./common/model` 导入，`index.tsx` 另外只导入 `./pages/app`。
- `model.ts` 集中再导出入口需要的东西。

## 10. 界面

底部三个标签：**记录**、**统计**、**设置**。

### 记录

- 按月分组，每组标题显示月份和当月花费。
- 加油行：日期、实付；升数 · 标号 · 里程；本次油耗（高于平均时用橙色）。
- 费用行显示类别名、金额、备注；保养行显示「保养」、花费、项目。
- 有未上传修改的行显示「待上传」。
- 点一行进入编辑，保养只能查看。
- 左滑删除，删除前确认。
- 下拉刷新：同步小熊。
- 右上角「+」菜单：记加油、记费用。车辆多于一辆时，左上角可以切换车辆。

### 记加油（表单）

| 分组 | 内容 |
|---|---|
| 时间与里程 | 时间；里程（数字键盘）；「从行程选择」（车辆关联了提供方时显示） |
| 金额 | 单价、升数、机显金额（小数键盘，任填两项）；实付；优惠（自动算） |
| 油品 | 标号（92 / 95 / 98 / 0 / 其他）；加满；油灯亮；上次漏记 |
| 油站 | 进入「选择油站」 |
| 备注 | 多行文本 |

- 保存前按 6.3 节核对：错误不能保存，警告确认后可以保存。
- 记费用的表单：时间、类别、金额、备注。

### 从行程选择

- 列出最近 7 天的停车，加油停车排在前面。
- 每行显示：结束时间、停留时长、地址或油站、里程，带「加油停车」「已记录」标记。
- 选中后填入里程（取整到公里）和时间（停车结束时间）；有油站时一并带出。

### 统计

- 范围切换：全部、今年、近 12 个月。
- 平均油耗、最近油耗、行驶里程、加油花费、其他费用、每公里花费。
- 每月花费柱状图、每次油耗折线图。

### 设置

- **车辆**：新增、编辑（名称、默认标号、关联小熊车辆、关联车辆数据）、删除（只能删本机车辆）。
- **小熊油耗**：凭据、账号、云端版本、上次同步、待上传条数、冲突提示；「立即同步」「自动上传」「断开」。
- **车辆数据**：每个提供方一项。按提供方定义的字段生成凭据输入框；「验证并读取车辆」；把远端车辆关联到车账本的车辆。
- **油站搜索**：方式（自动、高德、小熊、关闭）；高德 key。
- **默认值**：默认加满。
- **数据**：导出 JSON（包括从小熊映射来的记录）。
- **关于**：版本号。

## 11. 小组件

- `systemSmall`：车辆名、最近油耗（大字）、平均油耗、距上次加油几天。
- `systemMedium`：再加本月花费、当前里程（最后一条记录）、待上传条数。
- 只读 `appGroupDocumentsDirectory` 里的文件，不发网络请求。
- 点击小组件打开 `scripting://run/<脚本名>?action=add_fuel`，直接进入记加油。

## 12. 凭据与隐私

- Keychain：
  - `car_ledger.xxyh.token`：小熊 authToken；
  - `car_ledger.provider.<id>`：车辆数据凭据（JSON）；
  - `car_ledger.amap.key`：高德 key。
- 界面上不显示凭据明文，只显示开头 6 位和长度。
- 日志和错误信息不带凭据。
- 仓库里不提交任何真实数据：测试用合成数据，要用真实数据的测试从 `E:\GitHub\xxyh` 读取（第 13 节）。

## 13. 测试与验证

| 层 | 方式 |
|---|---|
| 领域、映射、操作、停车识别、签名 | Node：`npm test`（tsx + node:test），合成数据 |
| 与真实数据核对（可选） | 设置 `XXYH_ROOT=E:\GitHub\xxyh` 后，额外测试会读取 `out/xxyh_backup_v*.json` 和 `out/volvo_trips_archive.json`：<br>• 我们算的油耗与小熊的 `consumption` 一致<br>• 往返映射不丢字段<br>• 停车识别回放 73/74 |
| 在线只读（可选） | `LIVE=1`：小熊 `account_sync` 和下载最新版本；沃尔沃换会话、读车辆、读行程。**绝不上传。** |
| 类型 | `npm run check`：tsc 加载 Scripting 的 dts 做类型检查 |
| 界面 | `npx scripting-cli start` 同步到手机，在 Scripting 里运行 |

## 14. 路线图

- **v1**：本文范围。
- **v1.1**：截图识别。
  - 先用 iOS 本机文字识别（`Vision.recognizeText`）加规则解析；
  - 不行时依次用 Azure OpenAI、小熊识别；
  - 从油猴脚本移植标号判断（按单价对照当地 92# 油价）。
- **v1.2**：快捷指令和分享表单入口（`intent.tsx`，接收图片）、控制中心按钮、待补里程（行程还没同步时先存草稿）。
- **之后**：保养记录编辑、更多车辆数据提供方、发布到 GitHub Release 以支持远程更新。

## 15. 风险

| 风险 | 应对 |
|---|---|
| 上传整份备份时写坏小熊数据 | 只在最新版本上应用修改；7.6 节检查；保留最近 5 个版本；往返映射测试 |
| 官方 App 用旧数据覆盖 | 7.8 节说明；版本变化时提示 |
| 沃尔沃、小熊接口变化 | 错误分类显示；集成层集中在少数文件，便于修改 |
| 我这边不能运行 Scripting | 核心逻辑在 Node 测试，界面用 tsc 检查类型，然后在手机上实测 |
| 打包器的循环依赖问题 | 9.4 节的导入规则 |
