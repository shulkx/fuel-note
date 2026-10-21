// 读不出文字的保单 PDF：逐页显示后截图，本机 Vision 识别（设计文档 20.5 节）。由记保险表单弹出，识别完自动关闭。
// WebView 必须在屏幕上才能截图，所以这一页显示正在识别的那一页；尺寸与采样脚本相同（A4 比例，整页正好显示完）。
import { Button, HStack, Navigation, NavigationStack, ProgressView, Spacer, Text, VStack, WebView, useEffect, useRef, useState } from "scripting"
import { PickedPolicy, scanPolicyFile } from "../common/model"

/** 返回识别后的这几份（parsed 或 error 已填）；点「取消」时为 null */
export function PolicyScan({ files }: { files: PickedPolicy[] }) {
  const dismiss = Navigation.useDismiss()
  const [web] = useState(() => new WebViewController())
  const [name, setName] = useState(files[0]?.name ?? "")
  const [status, setStatus] = useState("正在打开")
  const cancelled = useRef(false)

  useEffect(() => {
    void (async () => {
      const out: PickedPolicy[] = []
      for (const [n, f] of files.entries()) {
        if (cancelled.current) return
        setName(f.name)
        const prefix = files.length > 1 ? `第 ${n + 1} / ${files.length} 份 · ` : ""
        out.push(await scanPolicyFile(f, web, (i, count) => setStatus(`${prefix}第 ${i + 1} / ${count} 页`)))
      }
      if (!cancelled.current) dismiss(out)
    })()
    return () => {
      cancelled.current = true
      web.dispose()
    }
  }, [])

  return <NavigationStack interactiveDismissDisabled>
    <VStack
      navigationTitle="识别扫描件"
      navigationBarTitleDisplayMode="inline"
      toolbar={{ cancellationAction: <Button title="取消" action={() => { cancelled.current = true; dismiss(null) }} /> }}
      spacing={12}
      padding
    >
      <Text font="headline" lineLimit={1}>{name}</Text>
      <WebView controller={web} frame={{ width: 320, height: 453 }} />
      <HStack spacing={8}>
        <ProgressView />
        <Text font="footnote" foregroundStyle="secondaryLabel">{status}</Text>
      </HStack>
      <Text font="footnote" foregroundStyle="secondaryLabel" multilineTextAlignment="center">这份 PDF 读不出文字，逐页截图后在本机识别，不上传。</Text>
      <Spacer />
    </VStack>
  </NavigationStack>
}
