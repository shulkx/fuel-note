// 油记的本机文字识别采样（开发用，不随油记发布；设计文档 16.3 节、20.10 节）。
// 从电脑上的 tools/ocr_bridge.mjs 取图片，用 iOS Vision 识别，把文字和位置传回电脑；
// 也可以从相册选图片，先传给电脑保存，再识别。
// 保单 PDF 用 PDFKit 逐页取文字传回电脑（油记 1.5 读保单用的是同一个接口）；保单文件夹里的图片（交强险标志）直接用 Vision 识别。
import { Button, List, Navigation, NavigationStack, ProgressView, Script, Section, Text, TextField, WebView, fetch, useEffect, useState } from "scripting"

type Item = { id: string; name: string; size: number; kind?: "image" | "pdf" | "ins_image"; done: boolean }

// 默认的最小文字高度是图片高度的 1/32，长截图里的小字会被丢掉，所以调小
const VARIANTS: Array<{ key: string; options: RecognizeTextOptions }> = [
  { key: "plain", options: { recognitionLevel: "accurate", recognitionLanguages: ["zh-Hans", "en-US"], usesLanguageCorrection: false, minimumTextHeight: 0.006 } },
  { key: "corrected", options: { recognitionLevel: "accurate", recognitionLanguages: ["zh-Hans", "en-US"], usesLanguageCorrection: true, minimumTextHeight: 0.006 } },
]

const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d

async function postJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), timeout: 30 })
  if (res.status !== 200) throw new Error(`${url} 返回 HTTP ${res.status}`)
  return res.json()
}

async function recognizeAndSend(server: string, file: string, image: UIImage): Promise<void> {
  for (const v of VARIANTS) {
    const t0 = Date.now()
    const r = await Vision.recognizeText(image, v.options)
    await postJson(`${server}/result`, {
      file,
      variant: v.key,
      options: v.options,
      width: image.width,
      height: image.height,
      ms: Date.now() - t0,
      text: r.text,
      candidates: r.candidates.map(c => ({
        t: c.content,
        c: round(c.confidence, 3),
        b: [round(c.boundingBox.x), round(c.boundingBox.y), round(c.boundingBox.width), round(c.boundingBox.height)],
      })),
    })
  }
}

/** 保单 PDF：PDFDocument 逐页取 string（读不出文字的页记为空串），连同页数和用时传回电脑 */
async function pdfTextAndSend(server: string, file: string, data: Data): Promise<void> {
  const t0 = Date.now()
  const doc = PDFDocument.fromData(data)
  if (!doc) throw new Error("PDF 无法打开")
  const pages: string[] = []
  for (let i = 0; i < doc.pageCount; i++) {
    const page = doc.pageAt(i)
    pages.push(page ? (await page.string) ?? "" : "")
  }
  await postJson(`${server}/pdf_result`, { file, pages, ms: Date.now() - t0 })
}

/** PDF 里有没有可读的文字 */
async function pdfHasText(data: Data): Promise<boolean> {
  const doc = PDFDocument.fromData(data)
  if (!doc) return false
  for (let i = 0; i < doc.pageCount; i++) {
    const page = doc.pageAt(i)
    if (page && ((await page.string) ?? "").trim()) return true
  }
  return false
}

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(() => resolve(), ms))

/** 与油记 platform/vision.ts 相同的识别参数；识别结果（文字块）传回电脑，page 从 0 数 */
async function ocrAndSend(server: string, file: string, page: number, image: UIImage): Promise<void> {
  const options: RecognizeTextOptions = { recognitionLevel: "accurate", recognitionLanguages: ["zh-Hans", "en-US"], usesLanguageCorrection: false, minimumTextHeight: 0.006 }
  const t0 = Date.now()
  const r = await Vision.recognizeText(image, options)
  await postJson(`${server}/pdf_ocr`, {
    file, page, width: image.width, height: image.height, ms: Date.now() - t0, text: r.text,
    candidates: r.candidates.map(c => ({ t: c.content, c: round(c.confidence, 3), b: [round(c.boundingBox.x), round(c.boundingBox.y), round(c.boundingBox.width), round(c.boundingBox.height)] })),
  })
}

/**
 * 读不出文字的 PDF：前 3 页逐页拆成单页 PDF，在页面上的 WebView 里显示、截图后用 Vision 识别（与油记的「识别扫描件」相同）。
 * 截图只截可见的部分，WebView 按 A4 比例显示一页
 */
async function pdfSnapshotAndSend(server: string, file: string, data: Data, web: WebViewController): Promise<void> {
  const doc = PDFDocument.fromData(data)
  if (!doc) throw new Error("PDF 无法打开")
  for (let i = 0; i < Math.min(doc.pageCount, 3); i++) {
    const one = PDFDocument.fromData(data)
    if (!one) throw new Error("PDF 无法打开")
    for (let j = one.pageCount - 1; j >= 0; j--) if (j !== i) one.removePageAt(j)
    const page = await one.data
    if (!page) throw new Error(`第 ${i + 1} 页无法取出`)
    await web.loadData(page, "application/pdf", "utf-8", "about:blank")
    await wait(1500)
    const image = await web.takeSnapshot({ snapshotWidth: 1240 })
    if (!image) throw new Error("WebView 截图失败（不在屏幕上？）")
    const jpeg = image.toJPEGData(0.9)
    if (jpeg) await fetch(`${server}/pdf_image?name=${encodeURIComponent(`${file.split("/").pop()}.p${i + 1}.jpg`)}`, { method: "POST", body: jpeg, timeout: 60 })
    await ocrAndSend(server, file, i, image)
  }
}

function Probe() {
  const dismiss = Navigation.useDismiss()
  const [web] = useState(() => new WebViewController())
  const [server, setServer] = useState("http://192.168.10.100:3100")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")
  const [errors, setErrors] = useState<string[]>([])

  async function run(task: (log: (s: string) => void, fail: (s: string) => void) => Promise<void>) {
    setBusy(true)
    setErrors([])
    const kept = await BackgroundKeeper.keepAlive().catch(() => false)
    const failed: string[] = []
    try {
      await task(setStatus, s => { failed.push(s); setErrors([...failed]) })
    } catch (e) {
      failed.push(e instanceof Error ? e.message : String(e))
      setErrors([...failed])
    } finally {
      if (kept) BackgroundKeeper.stopKeepAlive().catch(() => undefined)
      setBusy(false)
    }
  }

  /** 电脑上的图片：跳过已经有结果的，所以中断后可以接着跑 */
  const fromComputer = () => run(async (log, fail) => {
    const res = await fetch(`${server}/list`, { timeout: 15 })
    const items = (await res.json()) as Item[]
    const todo = items.filter(i => !i.done)
    console.log(`[probe] 待识别 ${todo.length} 张（共 ${items.length} 张）`)
    let ok = 0
    for (const [n, item] of todo.entries()) {
      log(`${n + 1} / ${todo.length}：${item.name}`)
      if (n % 10 === 0) console.log(`[probe] ${n + 1} / ${todo.length}`)
      try {
        if (item.kind === "pdf") {
          const pdf = await fetch(`${server}/pdf?id=${encodeURIComponent(item.id)}`, { timeout: 60 })
          await pdfTextAndSend(server, item.id, await pdf.data())
        } else if (item.kind === "ins_image") {
          // 保单文件夹里的图片（交强险标志 JPG）：与油记读图片相同，直接识别
          const img = await fetch(`${server}/pdf?id=${encodeURIComponent(item.id)}`, { timeout: 60 })
          const image = UIImage.fromData(await img.data())
          if (!image) throw new Error("图片无法读取")
          await ocrAndSend(server, item.id, 0, image)
        } else {
          const img = await fetch(`${server}/image?id=${encodeURIComponent(item.id)}`, { timeout: 60 })
          const image = UIImage.fromData(await img.data())
          if (!image) throw new Error("图片无法读取")
          await recognizeAndSend(server, item.id, image)
        }
        ok++
      } catch (e) {
        fail(`${item.name}：${e instanceof Error ? e.message : String(e)}`)
        console.log(`[probe] 失败 ${item.name}：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    log(`完成：${ok} 张（共 ${items.length} 张，之前已完成 ${items.length - todo.length} 张）`)
    console.log(`[probe] 完成 ${ok} / ${todo.length}`)
  })

  // 打开后自动开始（开发服务器改文件后会重新运行脚本，电脑端可以直接触发）
  useEffect(() => {
    console.log("[probe] 已启动，开始处理电脑上的保单 PDF 和图片")
    void fromComputer()
  }, [])

  /** 读不出文字的 PDF：WebView 显示 → 截图 → Vision 识别，结果和截图传回电脑 */
  const textlessPdfs = () => run(async (log, fail) => {
    const res = await fetch(`${server}/list`, { timeout: 15 })
    const items = ((await res.json()) as Item[]).filter(i => i.kind === "pdf")
    let ok = 0
    for (const [n, item] of items.entries()) {
      log(`检查 ${n + 1} / ${items.length}：${item.name}`)
      try {
        const pdf = await fetch(`${server}/pdf?id=${encodeURIComponent(item.id)}`, { timeout: 60 })
        const data = await pdf.data()
        if (await pdfHasText(data)) continue
        log(`截图识别：${item.name}`)
        await pdfSnapshotAndSend(server, item.id, data, web)
        ok++
      } catch (e) {
        fail(`${item.name}：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    log(`完成：截图识别 ${ok} 份`)
  })

  /** 相册：先把图片传给电脑保存，再识别 */
  const fromPhotos = () => run(async (log, fail) => {
    const images = await Photos.pickPhotos(30)
    let ok = 0
    for (const [n, image] of images.entries()) {
      log(`${n + 1} / ${images.length}`)
      try {
        const data = image.toJPEGData(0.92)
        if (!data) throw new Error("图片无法转换")
        const name = `phone-${Date.now()}-${n + 1}.jpg`
        const up = await fetch(`${server}/upload?name=${encodeURIComponent(name)}`, { method: "POST", body: data, timeout: 60 })
        const { id } = await up.json()
        await recognizeAndSend(server, id, image)
        ok++
      } catch (e) {
        fail(`第 ${n + 1} 张：${e instanceof Error ? e.message : String(e)}`)
      }
    }
    log(`完成：${ok} / ${images.length} 张`)
  })

  return <NavigationStack>
    <List navigationTitle="识别采样" navigationBarTitleDisplayMode="inline" toolbar={{ cancellationAction: <Button title="关闭" action={dismiss} /> }}>
      <Section header={<Text>电脑上的采样服务</Text>} footer={<Text>在电脑上运行 node tools/ocr_bridge.mjs。识别时请保持屏幕常亮。</Text>}>
        <TextField title="地址" value={server} onChanged={setServer} autocorrectionDisabled textInputAutocapitalization="never" keyboardType="URL" />
      </Section>
      <Section>
        <Button title="处理电脑上的保单 PDF 和图片" systemImage="desktopcomputer" action={fromComputer} disabled={busy} />
        <Button title="从相册选择并识别" systemImage="photo.on.rectangle" action={fromPhotos} disabled={busy} />
        <Button title="读不出文字的 PDF：截图再识别" systemImage="doc.viewfinder" action={textlessPdfs} disabled={busy} />
        {busy ? <ProgressView /> : null}
        {status ? <Text font="footnote">{status}</Text> : null}
      </Section>
      <Section header={<Text>PDF 预览（截图用，要留在屏幕上）</Text>}>
        <WebView controller={web} frame={{ width: 320, height: 453 }} />
      </Section>
      {errors.length ? <Section header={<Text>{`失败 ${errors.length} 张`}</Text>}>
        {errors.slice(-20).map((e, i) => <Text key={String(i)} font="footnote" foregroundStyle="systemRed">{e}</Text>)}
      </Section> : null}
    </List>
  </NavigationStack>
}

Navigation.present({ element: <Probe /> }).then(() => Script.exit())
