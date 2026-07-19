# Aico 8

[English](../README.md)

Aico 8 把你有权使用的 PICO-8 卡带重制成现代高清游戏，同时保持玩法、
操作、时序、音乐和音效不变。主要画面目标为 1024×1024 方屏。

输出包括 Web/PWA、Android APK，或者两者。Web 与 Android 使用同一套
游戏内核和资源。生成物默认只用于私人研究，不会自动上传或公开发布。

## 一个跨 Agent 的通用 Skill

Aico 8 不绑定某个模型或编码客户端。同一个 `aico8-remake` Skill 会在
Claude Code、Codex、OpenCode 和 Cherry Studio 中安装固定版本的完整工具链，
而不只是显示一份操作说明。它不依赖 Codex CLI；Web 重制直接使用随版本
发布并校验哈希的 Wasm 内核，普通用户不需要安装 C++、Emscripten 或
Android Studio。

使用终端型 Agent 时，复制对应的一行即可：

| Agent 客户端 | 一行安装 |
| --- | --- |
| Claude Code | `npx skills add https://github.com/YinsenW/Aico-8/tree/v0.1.3 -g -a claude-code -s aico8-remake -y` |
| Codex | `npx skills add https://github.com/YinsenW/Aico-8/tree/v0.1.3 -g -a codex -s aico8-remake -y` |
| OpenCode | `npx skills add https://github.com/YinsenW/Aico-8/tree/v0.1.3 -g -a opencode -s aico8-remake -y` |

该命令直接从 GitHub 安装，不需要加入 skills 注册表。Cherry Studio 用户从
[Releases](https://github.com/YinsenW/Aico-8/releases/latest) 下载
`aico8-remake.zip`，然后选择“资源库 → 添加 Skill → 本地导入”。ZIP 也是
同一个完整 Skill，不是删减版。Codex 插件外壳仅是可选便利入口，不是默认
产品，更不是其他 Agent 的依赖。

## 重制卡带

安装后新建一个 Agent 任务，拖入一个 `.p8` 或 `.p8.png` 卡带，然后说：

```text
用 Aico 8 重制这个已获授权的卡带，输出 Web 版。
```

或者：

```text
用 Aico 8 重制这个已获授权的卡带，输出 Web 版和 Android APK。
```

Agent 会自行加载 Skill、在本机私有目录安装完整的固定版本引擎、校验
预编译 Web/Wasm 内核、运行浏览器或 Android 模拟器验证，并返回最终文件。普通用户不需要理解仓库路径、构建
命令、TypeScript、C++、Wasm、Gradle 或 Android Studio。

## 仍然需要人的审查

高清重制不是机械放大。每款游戏仍须按顺序确认：

1. **神似还原**：身份、氛围、玩法和含义没有认错或变味。
2. **画质跃升**：分辨率、轮廓、材质、动画和细节确实提升。
3. **审美进化**：色彩、光影、构图和完成度符合现代审美，但不重构原作身份。

玩法兼容、构建和证据收集由 Agent 推进；语义理解、美术方向、代表性玩法
和最终范围必须由人明确决定。

## 项目组成

- **Skill**：跨 Agent 的自然语言操作入口。
- **工具链**：负责读取卡带、整合高清画面、验证和打包。
- **运行时**：在高清层下保持原始玩法和手感。

Android 只是封装已验证的 Web 内容，并不是另一套游戏实现。没有真机时，
浏览器和 Android 模拟器可以完成技术验收。

维护者从 [AGENTS.md](../AGENTS.md) 和
[docs/DEVELOPMENT.md](DEVELOPMENT.md) 开始。项目状态只以
[governance/project.json](../governance/project.json) 为准。

仓库代码采用 [Apache-2.0](../LICENSE)。该许可证不包括 PICO-8 本身、
第三方卡带、素材或生成的重制游戏。
