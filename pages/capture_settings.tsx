// 设置 › 记加油 › 截屏记加油（设计文档 19.4 节）：在账单详情页轻点两下手机背面，截屏并打开记加油表单
import { Button, HStack, List, Section, Text, VStack } from "scripting"

function Step({ n, title, detail }: { n: number; title: string; detail: string }) {
  return <HStack alignment="top" spacing={12}>
    <Text font="footnote" fontWeight="bold" foregroundStyle="white" frame={{ width: 24, height: 24 }} background={{ style: "systemGreen", shape: "circle" }}>{String(n)}</Text>
    <VStack alignment="leading" spacing={3}>
      <Text>{title}</Text>
      <Text font="footnote" foregroundStyle="secondaryLabel">{detail}</Text>
    </VStack>
  </HStack>
}

export function CaptureSettings() {
  return <List navigationTitle="截屏记加油" navigationBarTitleDisplayMode="inline">
    <Section
      header={<Text>设置步骤（只需一次）</Text>}
      footer={<Text>在账单详情页（微信、支付宝或加油站 App）轻点两下背面，油记会打开记加油表单，识别这张截图，并按账单上的付款时间配对那次加油停车。拍小票请在油记里点「+」，再选拍照。放在控制中心时，可以在最前面加「隐藏控制中心」和「等待 1 秒」。</Text>}
    >
      <Step n={1} title="新建快捷指令" detail="「快捷指令」App › 新建：添加「截屏」，再添加 Scripting 的「在 App 里运行意图」并选择「油记」，点开这一行的全部参数，把「截屏」放到「图像」一栏（不要放「参数」）。名称填「截屏记加油」。不要选「运行意图脚本」：它在后台运行，不会打开表单。" />
      <Step n={2} title="设为轻点背面" detail="设置 › 辅助功能 › 触控 › 轻点背面 › 轻点两下，选择「截屏记加油」。也可以放到操作按钮或控制中心。" />
      <Step n={3} title="允许油记接收图片" detail="Scripting 里油记的 Intent 设置中，「图片」需为勾选状态（油记已默认开启）。" />
    </Section>
    <Section>
      <Button title="打开「快捷指令」" systemImage="arrow.up.forward.app" action={() => { Safari.openURL("shortcuts://").catch(() => undefined) }} />
    </Section>
  </List>
}
