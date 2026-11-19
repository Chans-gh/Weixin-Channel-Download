# 安装、使用与故障排查

[返回仓库首页](../README.md) · [下载安装包](https://github.com/Chans-gh/Weixin-Channel-Download/releases/latest) · [查看兼容性](compatibility.md)

## 1. 准备运行环境

所有任务均需要 Node.js 24+ 和 npm。Agent 需要在能运行本机命令、读写工作区和输出目录的环境中执行。

| 要做的事 | 还需要准备 |
| --- | --- |
| 仅下载分享链接的 MP4，或仅导出链接的发布数据 | Google Chrome、可交互桌面和网络，用于在元宝登录、解析链接 |
| 从分享链接提取 WAV、转写，或边下载视频边导出含实际媒体规格的数据 | 上述 Chrome 环境，以及 FFmpeg 和 ffprobe |
| 导入本地音视频，或读取本地媒体规格 | FFmpeg 和 ffprobe。本地输入可跳过元宝登录 |
| 首次使用本地 Whisper | 网络及约 80 MB 的模型下载空间。缓存后可离线转写 |

FFmpeg 和 ffprobe 需在宿主能访问的 `PATH` 中，或作为可执行文件放入 Skill 下的 `.runtime/bin/`。转换视频容器时需 FFmpeg 支持 H.264 和 AAC 编码。可在终端运行 `node --version`、`npm --version`、`ffmpeg -version` 和 `ffprobe -version` 检查安装。

## 2. 安装对应宿主的 ZIP

1. **WorkBuddy** 打开「技能 → 添加技能 → 上传技能」，选择 WorkBuddy ZIP。
2. **DeepSeek Harness** 将对应 ZIP 解压到工作区的 `.agents/skills/`。打开该工作区，在技能列表选择 `weixin-channels-download-skill`。
3. **Codex** 将对应 ZIP 解压到项目的 `.agents/skills/`，或用户的 `~/.agents/skills/`。打开目标项目后，在会话中用 `$weixin-channels-download-skill` 调用。

对于 DeepSeek Harness 和 Codex，确认 `SKILL.md` 位于 `项目根目录/.agents/skills/weixin-channels-download-skill/SKILL.md`。使用 Codex 用户目录时，路径为 `~/.agents/skills/weixin-channels-download-skill/SKILL.md`。保留同目录下的脚本和锁文件。也可以把这个仓库直接作为工作区使用，仓库已包含上述项目级目录结构。

首次运行前，在 `SKILL.md` 所在目录运行以下命令，或让 Agent 在该目录执行。

```bash
npm ci --ignore-scripts
```

如需核验安装包，从同一个 Release 下载 `SHA256SUMS.txt`，与 ZIP 放在同一目录。macOS 可以运行 `shasum -a 256 weixin-channel-download-codex-v0.2.0.zip`，将文件名换成手头的安装包，与清单中对应一行比较。三个 ZIP 齐全时，可以用 `shasum -a 256 -c SHA256SUMS.txt` 一次校验。

## 3. 运行第一个任务

**分享链接**　从微信视频号复制一条 `https://weixin.qq.com/sph/…` 分享链接，和下面这句话一起交给 Agent。

> 用微信视频号下载 Skill 下载我提供的分享链接，保存 MP4，并告诉我完整的文件路径。

按提示在新打开的 Chrome 窗口手动登录腾讯元宝，并留着该窗口等原任务继续。默认登录等待约 3 分钟。任务已退出时可重新发起，再在新窗口登录。

**本地文件**　把一个文件放到 Agent 能访问的目录，提供实际路径。音频和视频都可以请求 WAV、口播和数据。

> 用微信视频号下载 Skill 导入我提供的本地音视频，保存 WAV、中文口播 TXT 和 JSON/CSV，并告诉我文件路径和实际使用的转写方式。

**指定目录**　默认保存到本机 `Downloads`。也可以在指令里加「把文件保存到我指定的目录」，同时给出路径。目录需支持写入和同目录硬链接。重名会追加编号。

## 4. 查看产物

| 格式 | 内容 |
| --- | --- |
| MP4 | 链接优先保存 H.264，其次是通用视频、H.265。导入本地 MP4 时保留原文件字节，其他支持的视频容器可转换为 MP4 |
| WAV | 第一条可用音轨，48 kHz、16 位 PCM |
| TXT | 简体中文口播稿，UTF-8，适合阅读和后续整理 |
| JSON / CSV | 分享来源的标题、发布文案、时间、作者和互动字段以实际返回为准。本地来源记录文件名和媒体规格。同时请求转写时，在口播任务完成或跳过后导出数据 |

发布文案来自平台，口播稿来自音轨，在 JSON 和 CSV 中各有自己的字段。评论条数可在平台返回时保存，评论正文和平台推荐量没有采集值。点赞或转发保留平台显示形式，如 `0` 和 `1万+`。缺失的互动字段在 JSON 中为 `null`，在 CSV 中为空。

## 5. 转写与排查

请求口播后，CLI 会先准备音轨并返回 `pending` 和任务编号 `jobId`。Skill 优先让当前会话已确认可用的 Agent 音频能力识别，再回填文本。音频输入不可用或识别失败时，用同一 `jobId` 直接切到本地 Whisper。成品结果中的 `transcription.engine` 会显示 `agent` 或 `local-whisper`。

| 遇到的问题 | 怎么继续 |
| --- | --- |
| 技能列表里看不到 Skill | 检查 ZIP 是否多套了一层目录，或打开的工作区是否正确，可重新打开工作区再查看。WorkBuddy 通过上传入口导入 ZIP |
| 启动 Chrome 失败，出现 `BROWSER_UNAVAILABLE` | 确认本机已安装 Google Chrome，且宿主能在当前桌面打开窗口 |
| 元宝登录超时或出现 `AUTH_EXPIRED` | 重跑同一链接，在新开的临时 Chrome 窗口完成元宝登录。如果无法打开元宝页面，检查网络 |
| 链接无效或出现 `FEED_UNAVAILABLE` | 从微信重新复制分享链接，确认分享预览仍可打开。已有本地媒体时，可以改用本地导入 |
| 提示 `MEDIA_TOOL_MISSING` 或 `AUDIO_TRACK_MISSING` | 前者需检查 FFmpeg 和 ffprobe，后者需换用带有音轨的文件或仅保存视频、数据 |
| Agent 提示 `Audio input is not available` | 让 Agent 用待转写任务编号执行本地 Whisper，无需再下载视频 |
| 本地 Whisper 提示 `MODEL_UNAVAILABLE` | 检查模型下载网络后，用同一编号重试。模型缓存位于 Skill 的 `.runtime/models/` |
| 识别提示 `SPEECH_EMPTY` 或 `SPEECH_UNCLEAR` | 检查音轨是否有清晰口播。保留原任务编号，可在可用的 Agent 音频会话里重试，或跳过口播并导出已请求的 JSON、CSV |
| 只生成了一部分文件 | 看结果的 `outputs` 和 `errors`。`outputs` 是已落盘的文件，按 `errors` 提示重试对应操作 |

使用已有任务编号时，从原来准备任务的 Skill 目录执行。以下命令各自独立，按需要选用。

```bash
node scripts/download.mjs --finish-transcription '<jobId>' --local-whisper
node scripts/download.mjs --finish-transcription '<jobId>' --transcript-file '/path/to/transcript.txt'
node scripts/download.mjs --finish-transcription '<jobId>' --skip-transcription
```

## 账号、文件与反馈

腾讯元宝登录凭据由临时 Chrome 会话持有。链接交给元宝解析，导出文件会排除临时授权地址。本地 Whisper 在本机读取音频。使用 Agent 音频时，音频交给当前宿主会话处理。

如果遇到问题，可以提交宿主和系统版本、任务类型、重现步骤以及脱敏的错误码或提示。请先从日志中移除 Cookie、令牌、带签名的地址、音视频内容和需要保密的本地路径。[提交 Issue](https://github.com/Chans-gh/Weixin-Channel-Download/issues/new)
