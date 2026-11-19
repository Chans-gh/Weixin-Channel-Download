# 微信视频号下载 Skill

把一条微信视频号分享链接下载为本地 MP4，也可以导入已有音视频，提取 WAV、转写简体中文口播，或导出 JSON 和 CSV。支持 **WorkBuddy、DeepSeek Harness 和 Codex**。

## 下载与安装

从 [GitHub Releases](https://github.com/Chans-gh/Weixin-Channel-Download/releases/latest) 下载对应的 ZIP。安装时保留整个 `weixin-channels-download-skill/` 目录，里面的脚本和锁文件会随 Skill 使用。

| 宿主 | 安装包 | 安装方法 |
| --- | --- | --- |
| WorkBuddy | `weixin-channel-download-workbuddy-*.zip` | 打开「技能 → 添加技能 → 上传技能」，直接上传 ZIP |
| DeepSeek Harness | `weixin-channel-download-deepseek-harness-*.zip` | 解压到工作区的 `.agents/skills/`，打开该工作区，在技能列表选择 `weixin-channels-download-skill` |
| Codex | `weixin-channel-download-codex-*.zip` | 解压到项目的 `.agents/skills/` 或用户的 `~/.agents/skills/`，使用 `$weixin-channels-download-skill` 调用 |

DeepSeek Harness 和 Codex 也可以直接打开本仓库作为工作区，使用仓库内的 `.agents/skills/`。首次调用可让宿主 Agent 在技能目录执行 `npm ci --ignore-scripts`，也可以在终端安装。宿主需要能运行本机命令和访问工作区及输出目录。

## 使用示例

- 「用微信视频号下载 Skill 下载这条分享链接，保存 MP4。」
- 「导入我提供的本地视频，提取 WAV，并把中文口播导出为 TXT。」
- 「保存视频号的发布文案和互动数据，导出 JSON 和 CSV。」

链接任务会打开一个临时 Chrome 窗口。收到提示后在该窗口手动登录腾讯元宝，当前进程会自动续跑。输出默认保存到系统用户的 `Downloads`，可指定其他目录，重名会追加序号。

## 运行环境

- **Node.js 24+** 与 npm 用于运行脚本和安装锁定依赖。
- **Google Chrome** 和可交互桌面用于打开分享链接、登录元宝并解析视频。
- **FFmpeg 和 ffprobe** 用于本地媒体导入、音轨提取和转写准备。可通过系统 PATH 提供，也可放到技能目录的 `.runtime/bin/`。
- **转写**优先使用宿主会话中已确认可用的原生音频输入。能力不可用或识别失败时，用同一任务切到 Whisper Base q8。首次需下载并校验约 80 MB 的模型，缓存完成后可离线识别；音频由本机 Whisper 处理。脚本返回实际使用的转写路径。

## 数据与验证

采集文件区分发布文案和转写口播。未返回的互动字段留空。转写和平台数据依赖实际音轨、模型和页面响应。

项目已在 macOS 验证真实元宝登录后下载 MP4，并用合成中文语音验证本地 Whisper、TXT 和 JSON/CSV。兼容性和发行包测试范围见 [发行说明](docs/compatibility.md)。命令、字段和开发测试见 [CLI 说明](.agents/skills/weixin-channels-download-skill/README.md)。

本项目与微信、腾讯、DeepSeek 或 OpenAI 没有官方从属关系。请处理你有权使用或下载的内容。代码采用 [Apache-2.0](LICENSE)，上游来源见 [NOTICE](.agents/skills/weixin-channels-download-skill/NOTICE.md)。
