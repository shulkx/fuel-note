// 设备上自动检查的验证脚本（开发用，不随油记发布）。验证 4 件事：
// 1. 电脑能连上手机开的 HttpServer；2. screenshotRef 能截到列表；3. 能自己弹出表单页、截图、再关掉；4. 开发服务器改了这个文件后，手机会不会重新运行。
// 打开后在 3200 端口等电脑的请求，并向电脑上的采样服务（tools/ocr_bridge.mjs）报到：手机地址、端口、STAMP。
import {
  Button, Circle, fetch, Form, HStack, List, Navigation, NavigationStack, ScreenshotMaker, Script, Section, Spacer, Text, TextField, VStack, ZStack, useEffect, useRef,
  useState,
} from "scripting"

/** 电脑改这个值后，手机重新运行时报到的 STAMP 跟着变（第 4 件事） */
const STAMP = "3"
const PORT = 3200

type Scheme = "light" | "dark"
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(() => resolve(), ms))
const query = (req: HttpRequest, key: string) => req.queryParams.find(q => q.key === key)?.value ?? ""
const png = (image: UIImage | null): HttpResponse => {
  const data = image?.toPNGData() ?? null
  return data ? HttpResponse.raw(200, "OK", { headers: { "Content-Type": "image/png" }, body: data }) : HttpResponse.internalServerError()
}

/** 截图样本：分组列表、徽章（圆、点、字）、一行带按钮 */
function Sample() {
  return [
    <Section key="a" header={<Text>当前保单</Text>}>
      <HStack spacing={14}>
        <ZStack frame={{ width: 72, height: 72 }}>
          <Circle fill="#248A3D" />
          <Circle fill="secondarySystemGroupedBackground" frame={{ width: 8, height: 8 }} offset={{ x: 14.4, y: -24.9 }} />
          <VStack spacing={0}>
            <Text font={19} fontWeight="bold" foregroundStyle="white">2027</Text>
            <Text font={11} fontWeight="semibold" foregroundStyle="white">1月</Text>
          </VStack>
        </ZStack>
        <VStack alignment="leading" spacing={3}>
          <Text font="subheadline" foregroundStyle="secondaryLabel">示例保险公司</Text>
          <Text font="title2" fontWeight="bold">¥1,234.56</Text>
          <Text font="caption" foregroundStyle="secondaryLabel">2026/1/7 – 2027/1/6 · 还有 77 天</Text>
        </VStack>
        <Spacer />
      </HStack>
    </Section>,
    <Section key="b" header={<Text>历年保险</Text>}>
      {["2026", "2025", "2024"].map(y => <HStack key={y}><Text font="headline">{y}</Text><Spacer /><Text>¥1,000.00</Text></HStack>)}
    </Section>,
  ]
}

/** 弹出的表单页：出现后把「截图」「关闭」交给调用方 */
function Presented({ scheme, ready }: { scheme: Scheme; ready: (take: () => UIImage | null, close: () => void) => void }) {
  const dismiss = Navigation.useDismiss()
  const ref = useRef<ScreenshotMaker>(null)
  const [name, setName] = useState("示例")
  useEffect(() => {
    ready(() => ref.current?.screenshot() ?? null, () => dismiss())
  }, [])
  return <NavigationStack>
    <Form navigationTitle="弹出的表单" navigationBarTitleDisplayMode="inline" screenshotRef={ref} environments={{ colorScheme: scheme }}>
      <Section header={<Text>字段</Text>}>
        <TextField title="名称" value={name} onChanged={setName} />
        <HStack><Text>保费</Text><Spacer /><Text foregroundStyle="secondaryLabel">1,234.00 元</Text></HStack>
      </Section>
    </Form>
  </NavigationStack>
}

function Check() {
  const dismiss = Navigation.useDismiss()
  const shot = useRef<ScreenshotMaker>(null)
  const [scheme, setScheme] = useState<Scheme>("light")
  const [bridge, setBridge] = useState("http://192.168.10.100:3100")
  const [status, setStatus] = useState("启动中")
  const [count, setCount] = useState(0)

  useEffect(() => {
    const server = new HttpServer()
    server.registerAsyncHandler("/ping", async () => {
      setCount(n => n + 1)
      return HttpResponse.ok(HttpResponseBody.text(JSON.stringify({ stamp: STAMP, at: Date.now() })))
    })
    // 第 2 件事：截这一页的列表（浅色或深色）
    server.registerAsyncHandler("/shot", async req => {
      setCount(n => n + 1)
      setScheme(query(req, "scheme") === "dark" ? "dark" : "light")
      await wait(800)
      return png(shot.current?.screenshot() ?? null)
    })
    // 第 3 件事：弹出表单页，等它出现后截图，再关掉
    server.registerAsyncHandler("/present", async req => {
      setCount(n => n + 1)
      let take: (() => UIImage | null) | null = null
      let close: (() => void) | null = null
      const done = Navigation.present({
        element: <Presented scheme={query(req, "scheme") === "dark" ? "dark" : "light"} ready={(t, c) => { take = t; close = c }} />,
      })
      await wait(1500)
      const image = take ? (take as () => UIImage | null)() : null
      if (close) (close as () => void)()
      await done
      return png(image)
    })
    const error = server.start({ port: PORT, forceIPv4: true })
    setStatus(error ? `启动失败：${error}` : `在 ${PORT} 端口等电脑的请求（STAMP ${STAMP}）`)
    console.log(`[check] ${error ? `启动失败：${error}` : `HttpServer 端口 ${server.port}，STAMP ${STAMP}`}`)
    // 向电脑报到：电脑从请求里看到手机的地址
    void fetch(`${bridge}/check_hello`, {
      method: "POST", headers: { "Content-Type": "application/json" }, timeout: 10,
      body: JSON.stringify({ port: server.port ?? PORT, stamp: STAMP, error }),
    }).catch(e => console.log(`[check] 报到失败：${e instanceof Error ? e.message : String(e)}`))
    return () => server.stop()
  }, [])

  return <NavigationStack>
    <List
      navigationTitle="FuelNote Check"
      navigationBarTitleDisplayMode="inline"
      toolbar={{ cancellationAction: <Button title="关闭" action={dismiss} /> }}
      screenshotRef={shot}
      environments={{ colorScheme: scheme }}
    >
      <Section header={<Text>状态</Text>} footer={<Text>保持这一页在屏幕上，屏幕不要锁。电脑会自己发请求，不用点任何东西。</Text>}>
        <Text>{status}</Text>
        <Text font="footnote" foregroundStyle="secondaryLabel">{`已收到 ${count} 个请求`}</Text>
        <TextField title="电脑地址" value={bridge} onChanged={setBridge} autocorrectionDisabled textInputAutocapitalization="never" keyboardType="URL" />
      </Section>
      {Sample()}
    </List>
  </NavigationStack>
}

Navigation.present({ element: <Check /> }).then(() => Script.exit())
