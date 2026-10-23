// 发给大模型前去掉文字里的个人信息（权益设计 5.2 节）：手机号、座机、证件号、车牌、车架号。截图原样发送，界面上写明。纯函数。

/** 车架号：17 位，不含 I、O、Q，同时有字母和数字 */
function vinLike(s: string): boolean {
  return /^[A-HJ-NPR-Z0-9]{17}$/i.test(s) && /\d/.test(s) && /[A-Z]/i.test(s)
}

export function redactText(text: string): string {
  return text
    .replace(/[A-Z0-9]{17}/gi, m => (vinLike(m) ? "[车架号]" : m))
    .replace(/(^|\D)(\d{17}[\dXx])(?!\d)/g, (_, a) => `${a}[证件号]`)
    .replace(/(^|\D)(1[3-9]\d{9})(?!\d)/g, (_, a) => `${a}[手机号]`)
    .replace(/(^|\D)(0\d{2,3}-?\d{7,8})(?!\d)/g, (_, a) => `${a}[电话]`)
    .replace(/[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][·•\s]?[A-Z0-9]{5,6}/g, "[车牌]")
}
