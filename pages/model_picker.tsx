// 选择车型（设计文档 17.4 节）：与小熊油耗的建车页相同，品牌 → 车系 → 车型，数据来自小熊的车型库。
// 整个选择是一个弹出页，选好车型后带着车型参数关闭；车型库标为不支持的车型不能选。
// 品牌含汽车、摩托车、货车，与官方 App 相同。
import {
  Button, ContentUnavailableView, HStack, Image, List, Navigation, NavigationLink, NavigationStack, ProgressView, Section, Spacer, Text,
  useEffect, useState,
} from "scripting"
import {
  CarSpec, CatalogBrand, CatalogItem, catalogBrands, catalogModels, catalogSeries, catalogSpec, errorText, groupBrands, groupModels,
} from "../common/model"

/** 读取中、出错、读到 */
function useLoad<T>(load: () => Promise<T>): { value: T | null; error: string | null } {
  const [value, setValue] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    setError(null)
    load().then(v => { if (alive) setValue(v) }, e => { if (alive) setError(errorText(e)) })
    return () => { alive = false }
  }, [])
  return { value, error }
}

function overlayFor(loading: boolean, error: string | null, empty: boolean) {
  if (error) return <ContentUnavailableView title="读取车型库失败" systemImage="exclamationmark.triangle" description={error} />
  if (loading) return <ProgressView />
  if (empty) return <ContentUnavailableView title="没有结果" systemImage="magnifyingglass" />
  return null
}

function ModelList({ brand, series, onPick }: { brand: CatalogBrand; series: CatalogItem; onPick: (spec: CarSpec) => void }) {
  const { value, error } = useLoad(() => catalogModels(brand.id, series.id))
  const [busy, setBusy] = useState<number | null>(null)

  async function pick(model: CatalogItem) {
    setBusy(model.id)
    try {
      const spec = await catalogSpec(model.id)
      if (!spec) {
        await Dialog.alert({ title: "该车型不支持，请重选", message: `小熊油耗的车型库里「${series.name} ${model.name}」标为不支持。` })
        return
      }
      onPick(spec)
    } catch (e) {
      await Dialog.alert({ title: "读取车型参数失败", message: errorText(e) })
    } finally {
      setBusy(null)
    }
  }

  const groups = value ? groupModels(value) : []
  const overlay = overlayFor(!value, error, !!value && !value.length)
  return <List navigationTitle={series.name} navigationBarTitleDisplayMode="inline" {...(overlay ? { overlay } : {})}>
    {groups.map(g => <Section key={g.year} header={<Text>{g.year}</Text>}>
      {g.models.map(m => <Button key={String(m.id)} action={() => pick(m)} disabled={busy != null}>
        <HStack>
          <Text foregroundStyle="label">{m.name}</Text>
          <Spacer />
          {busy === m.id ? <ProgressView /> : null}
        </HStack>
      </Button>)}
    </Section>)}
  </List>
}

function SeriesList({ brand, onPick }: { brand: CatalogBrand; onPick: (spec: CarSpec) => void }) {
  const { value, error } = useLoad(() => catalogSeries(brand.id))
  const overlay = overlayFor(!value, error, !!value && !value.length)
  return <List navigationTitle={brand.name} navigationBarTitleDisplayMode="inline" {...(overlay ? { overlay } : {})}>
    {(value || []).map(s => <NavigationLink key={String(s.id)} destination={<ModelList brand={brand} series={s} onPick={onPick} />}>
      <Text>{s.name}</Text>
    </NavigationLink>)}
  </List>
}

function BrandRow({ brand }: { brand: CatalogBrand }) {
  const mark = <Text font="caption" foregroundStyle="secondaryLabel" frame={{ width: 28, height: 28 }}>{brand.name.charAt(0)}</Text>
  return <HStack spacing={12}>
    {brand.logo
      ? <Image imageUrl={brand.logo} placeholder={mark} resizable scaleToFit frame={{ width: 28, height: 28 }} />
      : mark}
    <Text>{brand.name}</Text>
  </HStack>
}

export function ModelPicker() {
  const dismiss = Navigation.useDismiss()
  const { value, error } = useLoad(() => catalogBrands())
  const [keyword, setKeyword] = useState("")

  const k = keyword.trim().toLowerCase()
  const brands = (value || []).filter(b => !k || b.name.toLowerCase().includes(k) || b.letter.toLowerCase() === k)
  const groups = groupBrands(brands)
  const overlay = overlayFor(!value, error, !!value && !brands.length)
  const onPick = (spec: CarSpec) => dismiss(spec)

  return <NavigationStack>
    <List
      navigationTitle="品牌"
      navigationBarTitleDisplayMode="inline"
      toolbar={{ cancellationAction: <Button title="取消" action={() => dismiss(null)} /> }}
      searchable={{ value: keyword, onChanged: setKeyword, prompt: "搜索品牌" }}
      {...(overlay ? { overlay } : {})}
    >
      {groups.map(g => <Section key={g.letter} header={<Text>{g.letter}</Text>}>
        {g.brands.map(b => <NavigationLink key={String(b.id)} destination={<SeriesList brand={b} onPick={onPick} />}>
          <BrandRow brand={b} />
        </NavigationLink>)}
      </Section>)}
    </List>
  </NavigationStack>
}
