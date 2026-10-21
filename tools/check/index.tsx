// 手机上的自动检查的入口（开发用，不随油记发布）：只从 runner 导入（scripting-cli 打包器的限制）。说明见 tools/check/README.md。
import { Navigation, Script } from "scripting"
import { CheckPage } from "./runner"

Navigation.present({ element: <CheckPage /> }).then(() => Script.exit())
