# 微信视频号下载 Skill

把一条微信视频号分享链接保存为 MP4，再按需提取 WAV、转写简体中文口播、导出 JSON 和 CSV。已有音视频文件也可以直接导入处理。适用于 **WorkBuddy、DeepSeek Harness 和 Codex**。

[项目主页](https://chans-gh.github.io/Weixin-Channel-Download/) · [下载最新版本](https://github.com/Chans-gh/Weixin-Channel-Download/releases/latest) · [使用指南](docs/usage.md) · [反馈问题](https://github.com/Chans-gh/Weixin-Channel-Download/issues/new)

## 下载与安装

| 宿主 | v0.2.0 安装包 | 安装方法 |
| --- | --- | --- |
| WorkBuddy | [下载 ZIP](https://github.com/Chans-gh/Weixin-Channel-Download/releases/download/v0.2.0/weixin-channel-download-workbuddy-v0.2.0.zip) | 打开「技能 → 添加技能 → 上传技能」，选择 ZIP |
| DeepSeek Harness | [下载 ZIP](https://github.com/Chans-gh/Weixin-Channel-Download/releases/download/v0.2.0/weixin-channel-download-deepseek-harness-v0.2.0.zip) | 解压到工作区的 `.agents/skills/`，在技能列表选择 `weixin-channels-download-skill` |
| Codex | [下载 ZIP](https://github.com/Chans-gh/Weixin-Channel-Download/releases/download/v0.2.0/weixin-channel-download-codex-v0.2.0.zip) | 解压到项目或用户的 `.agents/skills/`，用 `$weixin-channels-download-skill` 调用 |

需要 **Node.js 24+ 和 npm**。首次使用，在 `SKILL.md` 所在目录运行 `npm ci --ignore-scripts`，也可让 Agent 执行。处理分享链接需要本机 **Google Chrome**、可交互桌面和网络。导入本地媒体、提取音轨或准备转写还需要 **FFmpeg 和 ffprobe**。目录示例、依赖和 [SHA-256 校验清单](https://github.com/Chans-gh/Weixin-Channel-Download/releases/download/v0.2.0/SHA256SUMS.txt) 的用法见[使用指南](docs/usage.md)。

## 第一次使用

在宿主里调用技能，附上一条从微信视频号复制的分享链接。可以先试这句。

> 用微信视频号下载 Skill 下载我提供的分享链接，保存 MP4。完成后告诉我文件路径。

收到登录提醒后，在弹出的临时 Chrome 窗口手动登录腾讯元宝。登录成功后，原任务会自动继续。文件默认保存到本机 `Downloads`，也可指定目录，重名会追加序号。

| 想做什么 | 给 Agent 的指令示例 |
| --- | --- |
| 导出音轨和口播 | 导入我提供的本地视频，提取 WAV，并把中文口播保存为 TXT。 |
| 只采集发布数据 | 导出这条视频号分享链接的发布文案和平台返回的互动数据，保存为 JSON 和 CSV。 |
| 导出全部产物 | 保存这条分享链接的 MP4、WAV、中文口播 TXT 和 JSON/CSV。 |

## 转写与数据

- 请求口播时，优先使用当前会话中已确认可用的 Agent 音频能力。会话无法接收音频或识别失败，便用本地 **Whisper Base q8** 继续同一任务。Whisper 首次需联网下载并校验约 80 MB 的模型，缓存后可离线识别。
- JSON 和 CSV 分别记录发布文案与语音转写。互动数据以平台返回值为准，缺失字段在 JSON 为 `null`、在 CSV 为空。导入本地文件时可导出时长、分辨率和编解码器等媒体信息。
- 每次处理一条分享链接或一个本地文件。公开分享预览能否返回视频或互动数据取决于平台及该链接。链接不可用时，可继续用手头已有的音视频文件。

## 验证与维护

在 macOS 已验证真实元宝登录后自动续跑并保存 MP4，以及用本地 Whisper 离线转写合成中文语音。Codex 和 DeepSeek Harness 已验证 Skill 发现。WorkBuddy 已检查上传入口和安装包结构，客户端导入尚未验证。详细范围见[宿主兼容性与构建](docs/compatibility.md)。

- [使用指南](docs/usage.md)涵盖安装、输出、登录和转写排查。
- [CLI 与开发测试](.agents/skills/weixin-channels-download-skill/README.md)提供完整参数、数据字段和验证命令。
- [问题反馈](https://github.com/Chans-gh/Weixin-Channel-Download/issues/new)请附宿主版本、系统、操作步骤和脱敏后的错误码或提示。

本项目为独立开源工具。请仅处理你有权下载或使用的内容。代码采用 [Apache-2.0](LICENSE)，上游来源见 [NOTICE](.agents/skills/weixin-channels-download-skill/NOTICE.md)。
