// 把待上传的修改应用到云备份上，以及上传前的检查（纯函数）
import { fmtShort } from "../../common/time"
import { carKey, isRefuel, newXxyhExpense, newXxyhFuel, newXxyhStation, patchXxyhExpense, patchXxyhFuel } from "./mapping"
import { XxyhBackup, XxyhCar, XxyhExpense, XxyhFuel, XxyhOp } from "./types"

export type OpConflict = { op: XxyhOp; reason: string }

type CarChange = { fuelAdded: number; fuelRemoved: number; expenseAdded: number; expenseRemoved: number; fuelTouched: Set<number>; expenseTouched: Set<number> }

export type ApplyResult = {
  doc: XxyhBackup
  conflicts: OpConflict[]
  /** 记录对应的油站已不存在、只好清掉油站的修改 */
  notes: string[]
  changes: Map<string, CarChange>
  /** 本次新建或更新了使用时间的油站 id */
  stationsTouched: Set<string>
}

export function describeOp(op: XxyhOp): string {
  if (op.type === "put_fuel") return `${fmtShort(op.data.ts)} 加油 ¥${op.data.paid.toFixed(2)}`
  if (op.type === "put_expense") return `${fmtShort(op.data.ts)} 费用 ¥${op.data.amount.toFixed(2)}`
  return `${fmtShort(op.key)} 的${op.type === "delete_fuel" ? "加油" : "费用"}记录（删除）`
}

// Scripting 把 .ts 也按 TSX 转译，`<T>(…) =>` 会被当成 JSX 标签：泛型只用函数声明
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v))
}

/** 第 n 条（从 1 开始）date 等于 key 的记录 */
function findNth<T extends { date: number }>(list: T[], pred: (r: T) => boolean, key: number, n = 1): number {
  let seen = 0
  for (let i = 0; i < list.length; i++) {
    if (pred(list[i]) && list[i].date === key) {
      seen++
      if (seen === n) return i
    }
  }
  return -1
}

/** 云备份里记录按时间倒序 */
function insertByDate<T extends { date: number }>(list: T[], rec: T): void {
  const i = list.findIndex(r => r.date < rec.date)
  if (i < 0) list.push(rec)
  else list.splice(i, 0, rec)
}

export function applyOps(base: XxyhBackup, ops: XxyhOp[]): ApplyResult {
  const doc = clone(base)
  const conflicts: OpConflict[] = []
  const notes: string[] = []
  const changes = new Map<string, CarChange>()
  const stationsTouched = new Set<string>()
  doc.myStations = doc.myStations || { stations: [] }
  doc.myStations.stations = doc.myStations.stations || []
  const stations = doc.myStations.stations
  const all = () => true

  const changeOf = (car: string): CarChange => {
    let c = changes.get(car)
    if (!c) {
      c = { fuelAdded: 0, fuelRemoved: 0, expenseAdded: 0, expenseRemoved: 0, fuelTouched: new Set(), expenseTouched: new Set() }
      changes.set(car, c)
    }
    return c
  }

  for (const op of ops) {
    const car: XxyhCar | undefined = doc.cars.find(c => carKey(c) === op.car)
    if (!car) { conflicts.push({ op, reason: "云端没有这辆车" }); continue }
    const ch = changeOf(op.car)

    if (op.type === "put_fuel") {
      const list = (car.fuelRecords = car.fuelRecords || [])
      const data = { ...op.data }
      if (op.station && !stations.some(s => String(s.id) === op.station!.id)) {
        stations.push(newXxyhStation(op.station, data.ts))
        stationsTouched.add(op.station.id)
      }
      if (data.station_id) {
        const st = stations.find(s => String(s.id) === data.station_id)
        if (st) {
          st.timeStamp = Math.max(Number(st.timeStamp) || 0, data.ts)
          stationsTouched.add(String(st.id))
        } else {
          notes.push(`${describeOp(op)}：油站已不在云端，已清除`)
          data.station_id = null
        }
      }
      if (op.key == null) {
        const same = findNth(list, isRefuel, data.ts)
        if (same >= 0) patchXxyhFuel(list[same], data) // 上次上传成功但没收到回应
        else { insertByDate<XxyhFuel>(list, newXxyhFuel(car, data)); ch.fuelAdded++ }
        ch.fuelTouched.add(data.ts)
      } else {
        const i = findNth(list, isRefuel, op.key, op.n)
        if (i < 0) { conflicts.push({ op, reason: "云端找不到这条加油记录，可能已在别处修改或删除" }); continue }
        const rec = list[i]
        patchXxyhFuel(rec, data)
        if (rec.date !== op.key) { list.splice(i, 1); insertByDate(list, rec) }
        ch.fuelTouched.add(op.key)
        ch.fuelTouched.add(data.ts)
      }
    } else if (op.type === "delete_fuel") {
      const list = car.fuelRecords || []
      const i = findNth(list, isRefuel, op.key, op.n)
      if (i >= 0) { list.splice(i, 1); ch.fuelRemoved++ }
      ch.fuelTouched.add(op.key)
    } else if (op.type === "put_expense") {
      const list = (car.expenseRecords = car.expenseRecords || [])
      if (op.key == null) {
        const same = findNth(list, all, op.data.ts)
        if (same >= 0) patchXxyhExpense(list[same], op.data)
        else { insertByDate<XxyhExpense>(list, newXxyhExpense(car, op.data)); ch.expenseAdded++ }
        ch.expenseTouched.add(op.data.ts)
      } else {
        const i = findNth(list, all, op.key, op.n)
        if (i < 0) { conflicts.push({ op, reason: "云端找不到这条费用记录，可能已在别处修改或删除" }); continue }
        const rec = list[i]
        patchXxyhExpense(rec, op.data)
        if (rec.date !== op.key) { list.splice(i, 1); insertByDate(list, rec) }
        ch.expenseTouched.add(op.key)
        ch.expenseTouched.add(op.data.ts)
      }
    } else if (op.type === "delete_expense") {
      const list = car.expenseRecords || []
      const i = findNth(list, all, op.key, op.n)
      if (i >= 0) { list.splice(i, 1); ch.expenseRemoved++ }
      ch.expenseTouched.add(op.key)
    }
  }
  return { doc, conflicts, notes, changes, stationsTouched }
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/**
 * 上传前检查：除了这次修改的记录，其他内容必须与下载的版本完全一致。返回问题列表，为空才可以上传。
 */
export function validateUpload(before: XxyhBackup, result: ApplyResult): string[] {
  const after = result.doc
  const problems: string[] = []
  const topKeys = new Set([...Object.keys(before), ...Object.keys(after)])
  for (const k of topKeys) {
    if (k === "cars" || k === "myStations") continue
    if (!same(before[k], after[k])) problems.push(`备份的 ${k} 被意外修改`)
  }
  const beforeCars = before.cars || []
  const afterCars = after.cars || []
  if (beforeCars.length !== afterCars.length || beforeCars.some((c, i) => carKey(c) !== carKey(afterCars[i]))) {
    problems.push("车辆列表与下载的版本不一致")
    return problems
  }
  beforeCars.forEach((b, i) => {
    const a = afterCars[i]
    const ch = result.changes.get(carKey(b))
    const name = String(b.name || carKey(b))
    for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
      if (k === "fuelRecords" || k === "expenseRecords") continue
      if (!same(b[k], a[k])) problems.push(`${name} 的 ${k} 被意外修改`)
    }
    const check = <T extends { date: number; wc_id?: number }>(label: string, bl: T[], al: T[], touched: Set<number>, added: number, removed: number) => {
      if (al.length !== bl.length + added - removed) problems.push(`${name} 的${label}条数不符：${bl.length} + ${added} − ${removed} ≠ ${al.length}`)
      const remaining = al.filter(r => !touched.has(r.date)).map(r => JSON.stringify(r))
      const pool = new Map<string, number>()
      for (const s of remaining) pool.set(s, (pool.get(s) || 0) + 1)
      for (const r of bl) {
        if (touched.has(r.date)) continue
        const s = JSON.stringify(r)
        const n = pool.get(s) || 0
        if (!n) { problems.push(`${name} 的${label} ${new Date(r.date).toISOString()} 被意外修改`); continue }
        pool.set(s, n - 1)
      }
      const wc = al.map(r => r.wc_id).filter(v => v != null)
      if (new Set(wc).size !== wc.length) problems.push(`${name} 的${label}编号重复`)
    }
    check("加油记录", b.fuelRecords || [], a.fuelRecords || [], ch?.fuelTouched || new Set(), ch?.fuelAdded || 0, ch?.fuelRemoved || 0)
    check("费用记录", b.expenseRecords || [], a.expenseRecords || [], ch?.expenseTouched || new Set(), ch?.expenseAdded || 0, ch?.expenseRemoved || 0)
  })
  const bs = before.myStations?.stations || []
  const as = after.myStations?.stations || []
  const ids = as.map(s => String(s.id))
  if (new Set(ids).size !== ids.length) problems.push("油站 id 重复")
  for (const s of bs) {
    const t = as.find(x => String(x.id) === String(s.id))
    if (!t) { problems.push(`油站「${s.name}」丢失`); continue }
    if (!same({ ...s, timeStamp: 0 }, { ...t, timeStamp: 0 })) problems.push(`油站「${s.name}」被意外修改`)
  }
  for (const k of Object.keys(after.myStations || {})) {
    if (k !== "stations" && !same((before.myStations || {})[k], (after.myStations || {})[k])) problems.push(`myStations.${k} 被意外修改`)
  }
  // 只检查新出现的悬空油站引用（旧数据本来就有的不算）
  const danglingBefore = new Set<string>()
  const bIds = new Set(bs.map(s => String(s.id)))
  for (const c of beforeCars) for (const r of c.fuelRecords || []) if (r.stationId && !bIds.has(String(r.stationId))) danglingBefore.add(String(r.stationId))
  const aIds = new Set(ids)
  for (const c of afterCars) {
    for (const r of c.fuelRecords || []) {
      const sid = r.stationId ? String(r.stationId) : ""
      if (sid && !aIds.has(sid) && !danglingBefore.has(sid)) problems.push(`加油记录引用了不存在的油站 ${sid}`)
    }
  }
  return problems
}
