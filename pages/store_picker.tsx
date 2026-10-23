// 选择门店（设计文档 22.11 节，画布 R7StorePicker）：门店的家。记费用、添加权益、记一次使用都推入这一页，设置里不另开入口。
// 列出「不选门店」、我的门店和从费用备注最后一行认出的店（第二行「来自费用备注 · N 笔」，选了以后才加进我的门店）、新建；
// 我的门店左滑可以改名、删除（直接写进账本）。1.7.0-beta.2 加高德搜索。
import { Button, EnvironmentValuesReader, HStack, Image, List, Section, Spacer, Text, useState, VStack } from "scripting"
import { AppData, currentVehicle, storeCandidates, Store, vehicleRecords } from "../common/model"
import { StoreActions } from "./benefit_parts"

export function StorePicker({ getData, selected, onPick, stores }: {
  getData: () => AppData
  selected: Store | null
  /** 选了一家（null = 不选门店） */
  onPick: (s: Store | null) => void
  stores: StoreActions
}) {
  // 改名、删除、新建后重新读账本
  const [, setVersion] = useState(0)
  const data = getData()
  const v = currentVehicle(data)
  const candidates = storeCandidates(data.ledger.stores ?? [], v ? vehicleRecords(data, v) : [])
  const isSelected = (s: Store) => !!selected && (selected.id === s.id || selected.name === s.name)

  function pick(s: Store | null, back: () => void) {
    onPick(s)
    back()
  }

  async function create(back: () => void) {
    const name = (await Dialog.prompt({ title: "新建门店", message: "写费用备注最后一行时用的店名，例如「示例沃尔沃」。", placeholder: "店名", confirmLabel: "添加" }))?.trim()
    if (!name) return
    const saved = stores.save({ id: "", name, full_name: "", address: "", phone: "", lng: null, lat: null, source: "manual" })
    pick(saved, back)
  }

  async function rename(s: Store) {
    const name = (await Dialog.prompt({ title: "修改店名", defaultValue: s.name, selectAll: true, confirmLabel: "保存" }))?.trim()
    if (!name || name === s.name) return
    stores.save({ ...s, name })
    setVersion(x => x + 1)
  }

  async function remove(s: Store) {
    const choice = await Dialog.actionSheet({
      title: `删除「${s.name}」？`,
      message: "用到它的权益改成不限门店；费用备注里写的店名不动。",
      actions: [{ label: "删除", destructive: true }],
    })
    if (choice !== 0) return
    stores.remove(s.id)
    setVersion(x => x + 1)
  }

  return <EnvironmentValuesReader keys={["dismiss"]}>{env => <List navigationTitle="选择门店" navigationBarTitleDisplayMode="inline">
    <Section key="none">
      <Button action={() => pick(null, env.dismiss)}>
        <HStack foregroundStyle="label">
          <Text>不选门店</Text>
          <Spacer />
          {selected ? null : <Image systemName="checkmark" foregroundStyle="accentColor" />}
        </HStack>
      </Button>
    </Section>
    <Section key="mine" header={<Text>我的门店</Text>}
      footer={<Text>从费用备注最后一行认出的店，选了以后加进我的门店。左滑可以改名、删除。</Text>}>
      {candidates.map(c => <Button
        key={c.store.id}
        action={() => pick(c.store, env.dismiss)}
        {...(c.fromRemark ? {} : {
          trailingSwipeActions: {
            allowsFullSwipe: false,
            actions: [
              <Button title="删除" systemImage="trash" tint="systemRed" action={() => { void remove(c.store) }} />,
              <Button title="改名" systemImage="pencil" tint="systemBlue" action={() => { void rename(c.store) }} />,
            ],
          },
        })}
      >
        <HStack foregroundStyle="label">
          <VStack alignment="leading" spacing={2}>
            <Text>{c.store.name}</Text>
            {c.fromRemark
              ? <Text font="caption" foregroundStyle="secondaryLabel">{`来自费用备注 · ${c.count} 笔`}</Text>
              : c.store.full_name || c.store.address
                ? <Text font="caption" foregroundStyle="secondaryLabel" lineLimit={2}>{[c.store.full_name, c.store.address].filter(Boolean).join("\n")}</Text>
                : null}
          </VStack>
          <Spacer />
          {isSelected(c.store) ? <Image systemName="checkmark" foregroundStyle="accentColor" /> : null}
        </HStack>
      </Button>)}
      <Button title="新建门店" systemImage="plus" action={() => { void create(env.dismiss) }} />
    </Section>
  </List>}</EnvironmentValuesReader>
}
