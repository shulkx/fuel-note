# 油记与小熊油耗的数据对应

截至 1.7.0。左边是油记的数据结构（`common/types.ts`），右边是小熊油耗云备份里的字段（`sync/xxyh/types.ts`），中间写怎么转换。代码位置写在括号里，方便以后核对。

> 2.0 起不再自动同步（`docs/specs/2026-10-24-local-first.md`）：小熊的数据在导入时复制成油记的记录（`sync/xxyh/import.ts`），原样存在记录的 `xxyh_raw`；导出（2.0.0-beta.4）时以原样为底写回。下面的字段对应照旧适用；「同步」一栏里的上传、操作（`XxyhOp`）、`validateUpload`、`x:<车>:<f|e|m>:<时间>` 编号是 1.x 的做法，2.0 的记录有自己的 id。保养和费用在导入时按同一时刻配对，存成 `MaintenanceRecord.expense_id`。

几条通用的约定：

- 时间两边都是毫秒时间戳，不换算。
- 金额两边都是「元」的小数，比较时误差 0.005 以内算相等（`mapping.ts` 的 `near`）。
- 里程是整数公里，升数是小数。
- 油记只上传「修改操作」（`XxyhOp`），上传时在云端最新版本上应用这些操作，只改变化的字段；油记不认识的字段原样保留。

## 1. 总览

| 油记 | 小熊 | 同步 |
|---|---|---|
| `Vehicle`（车辆） | `cars[]` | 关联键是 `xxyh_car` = `uuid`；名称、车型只在新建时写一次 |
| `FuelData`（加油） | `cars[].fuelRecords[]` | 双向，读、增、改、删 |
| `ExpenseData`（费用） | `cars[].expenseRecords[]` | 双向，读、增、改、删 |
| `MaintenanceRecord`（保养） | `cars[].maintainRecords[]` | 只读（1.8 起可写，见第 5 节） |
| `Station`（油站） | `myStations.stations[]` | 读；记加油用到新油站时新增 |
| `ExpenseCategory`（费用类别） | `expenseTypes[]` | 只读 |
| 保险、权益、门店、设置 | 没有 | 只在本机，见第 8 节 |
| 没有 | `incomeRecords`、`reminderRecords`、`incomeTypes`、充电记录等 | 原样保留，不显示，上传前检查不许改动 |

## 2. 车辆：`Vehicle` ↔ `cars[]`

| 小熊字段 | 油记 | 说明 |
|---|---|---|
| `uuid`（字符串或数字） | `Vehicle.xxyh_car` | 读时转成字符串。新建时生成 10 位数字；云端删除后重新上传时用回原来的（`former_xxyh_car`） |
| `name` | `Vehicle.name` | 只在新建油记车辆时复制、在小熊新建车辆时写一次；之后改名不同步 |
| `model` | `profile.model` | 车型库编号，-1 表示没有 |
| `pinpai`、`chexi` | `profile.pinpai`、`profile.chexi` | 网页版建的车才有 |
| `vehicle_type` | `profile.vehicle_type` | 新建时缺省 1 |
| `replenishMode` | `profile.replenish_mode` | 1 燃油、2 纯电、3 插混或增程 |
| `gasType`（如「95号」） | `profile.gas_type` | 建车时推出默认标号 `default_grade` |
| `buyDate`（YYYY-MM-DD） | `profile.buy_date` | |
| `sortId`、`sortKey`、`selected`、`avgConsumption`、`odometerCorrection` | 不读 | 新建时写默认值 |
| `fuelRecords`、`expenseRecords`、`maintainRecords` | 见第 3–5 节 | 新建时都是空数组 |

只在油记本机：`id`、`default_grade`、`created_ts`、`provider`（沃尔沃车况）、`hidden`、`former_xxyh_car`、`profile.model_name`。

## 3. 加油：`FuelData` ↔ `fuelRecords[]`

| 小熊字段 | 油记 | 说明 |
|---|---|---|
| `date` | `ts` | |
| `odometer` | `odometer` | |
| `fueledLiter` | `liters` | 旧记录是 0 时按 `yuan / price` 推算（只用于显示，不写回） |
| `price` | `price` | 单价，元/升 |
| `yuan` | `amount` | 机显金额 |
| `payYuan` | `paid` | 实付；是 0 时按 `yuan` 算 |
| `type` | `grade` | 92、95、98、0（柴油）；旧数据里有 93 |
| `gassup` | `full` | 加满 |
| `fPercentAfterFuel` | 不读 | 切换「加满」时跟着写 1 或 0 |
| `lightOn` | `light_on` | 加油前油灯亮 |
| `forget` | `missed_before` | 上次加油漏记 |
| `stationId`（"" 表示没有） | `station_id` | 引用的油站在云端不存在时清空，并提示 |
| `remark` | `remark` | |
| `replenishType` | 只认 1（加油） | 其他值（充电）原样保留、不显示 |
| `wc_id` | 不读 | 新建时取这辆车的最大值 + 1，上传前检查不能重复 |
| `carId` | 不读 | 新建时沿用这辆车已有记录的值 |
| `id` | 不读不写 | 小熊 App 写的记录 `id` 等于 `wc_id`；油记新建的没有 |
| `consumption` 及电量、容量等其余字段 | 不读 | 新建时写 0、false 或空数组，由小熊 App 重算 |

## 4. 费用：`ExpenseData` ↔ `expenseRecords[]`

| 小熊字段 | 油记 | 说明 |
|---|---|---|
| `date` | `ts` | |
| `type` | `category_id` | `expenseTypes._id`：100000 行车费、100001 维修保养、100002 保险和交通规费、100003 其它，以及用户自建的类别；缺失时当作 100003 |
| `expense` | `amount` | 1.7 起写实付（扣掉权益抵扣以后） |
| `description` | `remark` | 可以多行；最后一行可能是油记写的权益用量和门店（见第 8 节） |
| `wc_id`、`carId`、`remarkImages` | 不读 | 新建时补上 |
| `maintain_id` | 不读不写 | 小熊 App 给保养自动生成的那笔费用才有；修改时原样保留。只在新建时记下来源，之后不再维护，见第 5 节 |

## 5. 保养：`MaintenanceRecord` ↔ `maintainRecords[]`

现在只读（`mapping.ts` 的 `maintenanceFromXxyh`）。

| 小熊字段 | 油记 | 说明 |
|---|---|---|
| `dateTime` | `ts` | 注意字段名不是 `date` |
| `currentMileage` | `odometer` | |
| `maintains`（「机油,机油滤清器,」，带尾逗号） | `items` | 和 `customMaintains` 拼起来、按逗号切开、用「、」连接；拼完拆不回两段 |
| `customMaintains` | `items` | 自定义项目 |
| `spend` | `amount` | |
| `message` | `remark` | 如「第五次保养」，可以为空 |
| `id`、`wc_id`、`carId`、`addTime`、`isCost`、`hasNotify`、`remarkImages` | 不读 | 真实数据里 `id` 都是 0；记录按 `addTime` 倒序排，不按 `dateTime` |

**保养和费用的关系**：小熊 App 记一次保养时，同时写一条保养记录和一笔维修保养费用：

- 费用的 `type` 是 100001，`date` 和保养的 `dateTime` 相同，金额等于 `spend`；
- `description` 是「<message>\n保养里程：<里程>公里\n保养项目：<maintains>\n」（`message` 为空时没有第一行）；
- 费用带 `maintain_id`，是新建时那条保养的编号，之后不再维护。

`maintain_id` 的用途（2026-10-24 反编译小熊安卓版 4.0.4 核对）：

- 安卓版只在新建保养、勾了「记录为费用」时写：值是这条保养的 `_ID`（新建时的毫秒时间戳），费用的备注是「记录时间：…\n行驶里程：…公里\n保养项目：…」。
- 之后从不读它：修改保养不改那笔费用，删除保养也不删费用；读取只出现在数据库写入里。
- 真实数据是 iOS 版写的（备注格式不同，`customMaintains`、`isCost`、`hasNotify` 安卓版都没有）：`maintain_id` 是 1–7 的小整数，和保养的 `wc_id` 同一范围但一一对不上，推测是新建时那条保养的编号，恢复备份重新编号后就失效了。小熊照常显示，说明 iOS 版也不靠它。

所以油记按「同一时刻」配对（`expense_stats.ts` 的 `maintenanceExpenses`，同一时刻有几笔时优先维修保养），在费用页合成一行、金额只算一次。只改了其中一边的时间，配对就会断开。

**1.8 要做的**（实施文档 1.8 一节）：

- 新操作 `put_maintain`、`delete_maintain`，上传前检查保养记录条数；
- 新记录照小熊 App 的写法，同时写保养记录和那笔费用，并补齐 `id`、`wc_id`、`carId`、`addTime`、`isCost`、`hasNotify`、`remarkImages`；
- 本机车辆也能存保养；`MaintenanceRecord` 要分开存 `maintains` 和 `customMaintains`；
- 现有代码按 `date` 字段找记录、排顺序、做上传前检查，保养要另写；新增一笔和已有费用同一时刻的费用时会被当成修改，先写保养、再写费用时要注意。

## 6. 油站：`Station` ↔ `myStations.stations[]`

| 小熊字段 | 油记 | 说明 |
|---|---|---|
| `id` | `Station.id` | 新油站按经纬度算出 id |
| `name`、`address`、`province`、`city` | 同名字段 | |
| `area` | `district` | |
| `longitudeE6`、`latitudeE6` | `lng`、`lat` | 整数，单位百万分之一度；`coordinate_type` 是 `wgs84` 时直接用，否则当作 BD-09 转成 WGS-84（近似）。油记新建的一律写 WGS-84 |
| `timeStamp` | `last_used_ts` | 引用已有油站时更新为较晚的时间 |
| `phoneNum`、`tel`、`poiId`、`src`、`isCustom`、`sType` | 不读 | 新建时写自定义油站的默认值 |

## 7. 费用类别：`ExpenseCategory` ↔ `expenseTypes[]`

`_id` → `id`，`name`、`description` → 同名字段，`sortId` 只用来排序；`color`、`spendType`（1 普通、2 按年分摊）不读。油记从不写这个数组，所以不能在油记里新建类别。

## 8. 只在油记本机的数据

| 油记 | 在小熊里留下的痕迹 |
|---|---|
| 保险 `InsuranceYear`、`Policy` | 一笔「保险和交通规费」（100002）费用：金额是保费合计，备注是「2026 车险 · <保险公司>」加上用户写的备注。费用的 id 随日期变化，按时间、类别、金额重新找回 |
| 权益 `Perk`、使用记录 `PerkUse` | 费用金额写实付；备注最后一行写用了什么，如「维修保养券抵扣 ¥1,000.00 · 基础保养 1 次 · <门店>」。使用记录按费用的时间对应费用，不按 id |
| 门店 `Store` | 小熊的费用和保养都没有门店字段。门店名写在费用备注的最后一行（单独一行，或跟在权益用量后面），编辑时拆回来 |
| 设置、本机车辆的记录、本机油站、本机费用类别 | 没有。本机车辆「转为小熊车辆」时，记录和用到的油站一起上传 |

## 9. 记录的标识、编辑和删除

- 小熊记录在油记里的 id 是 `x:<车>:<f|e|m>:<时间>`，同一时刻的第 2 条起加 `#n`（加油、费用、保养分开数）。不用 `wc_id`，因为恢复备份后它会被重新编号。
- 修改、删除操作记下原记录的时间和序号，上传时在云端最新版本里按时间找到那一条，只改变化的字段；改了日期的挪回按时间倒序的位置。
- 修改时找不到原记录算冲突，放弃这条修改；删除时找不到当作已经删掉。
- 新增时云端已有同一时刻的记录，当作修改（处理「上次上传成功但没收到回应」）；所以两条毫秒完全相同的新记录会合成一条。
- 删除一笔费用时，对应的保险年度和权益使用记录一起处理。

## 10. 有损和要注意的地方

1. 新记加油时标号没填，会写成 `type` 0，在小熊里显示为柴油；修改时也清不掉已有的标号。
2. 切换「加满」会覆盖 `fPercentAfterFuel`。
3. 新建的加油记录不写 `id`，`consumption` 等计算字段写 0，由小熊 App 重算。
4. 改过一笔小熊格式的保养费用（其他字段变了）时，备注末尾的换行会被去掉。
5. 本机默认类别叫「其他」，小熊叫「其它」；转成本机车辆时只补上缺的类别，不覆盖名称。
6. 保养的项目拼成一个字符串后拆不回 `maintains` 和 `customMaintains`；转成本机车辆时，已配对的保养只留下那笔费用。
