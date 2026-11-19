# 微信视频号媒体与数据 Skill

输入一条视频号分享链接或一个本地音视频文件。按需导出 MP4、WAV、简体中文口播稿及 JSON 和 CSV。链接视频默认选取顺序为 H.264、通用视频、H.265。文件名使用独立标题加日期，标题缺失时用分享短链编号或导入文件名。重名时追加序号。

## 安装

使用 Node.js 24+，在本目录运行 `npm ci --ignore-scripts`。链接任务使用本机 Google Chrome 与可交互桌面。本地导入、格式转换及音轨提取使用 FFmpeg 和 ffprobe。将带 H.264 和 AAC 编码支持的可执行文件放入本工具的 `.runtime/bin/`，或使用 PATH 中的安装。仅根据链接下载 MP4 或提取平台数据时可以直接运行。 [FFmpeg 下载与安装](https://ffmpeg.org/download.html)

## 调用

```sh
# 仅下载一条链接的默认视频
node scripts/download.mjs 'https://weixin.qq.com/sph/…'

# 准备视频、音轨及转写任务，回填转写后导出数据
node scripts/download.mjs 'https://weixin.qq.com/sph/…' --all

# 从本地媒体准备中文口播和数据
node scripts/download.mjs '/path/to/input.mp4' --transcribe --data

# 使用上一命令返回的 jobId 和 Agent 转写的 UTF-8 文本
node scripts/download.mjs --finish-transcription '<jobId>' --transcript-file '/path/to/transcript.txt'

# Agent 没有音频输入或转写失败时，用同一任务在本机识别
node scripts/download.mjs --finish-transcription '<jobId>' --local-whisper
```

| 选项 | 输出 |
| --- | --- |
| `--video` | 保存链接 MP4 或将本地视频另存为 MP4。本地已有 MP4 时保留原文件字节，其他支持的视频容器转换为 H.264，包含音轨时以 AAC 保存 |
| `--audio` | 第一条可用音轨，48 kHz、16 位 PCM WAV |
| `--transcribe` | 为 Agent 或本地 Whisper 准备 WAV。转写结果经 OpenCC 转简体并整理标点和换行，输出 UTF-8 TXT |
| `--data` | JSON 和含 BOM 的 CSV。链接采集平台字段，本地导入读取实际的时长、分辨率和编解码器 |
| `--all` | 执行以上四项。音频文件需要单独使用 `--audio --transcribe --data`，即可避开无视频轨的结果 |

选项可组合。本地文件省略选项时运行 `--data`，可导入 MP4、MOV、WebM、MKV、AVI、MPEG-TS、WAV、AAC、M4A、MP3、FLAC、Ogg 和 AIFF。默认保存到 `~/Downloads`，可用 `--output-dir '目标目录'` 修改。目录需支持同目录硬链接，成品以独占方式写入。

旧单条下载调用继续输出 `ok`、`path`、`bytes` 和 `version`。组合操作在 `outputs` 列出实际生成的文件路径，在 `errors` 列出各项失败原因。部分成功时退出码为 1，之前保存的成品可继续使用。仅取链接音轨或口播时使用临时 MP4。

导入 [SKILL.md](SKILL.md) 后，可以直接提示 `$weixin-channels-download-skill 导入 /path/to/video.mp4，提取口播和数据`。

## 口播转写

CLI 的 `transcription.status` 为 `pending` 时，`jobId` 和 `audioPath` 可用于下一步。此时 `ok` 只表示准备阶段的结果。Skill 默认优先用当前会话中已确认的 Agent 音频输入转写，并通过 `--transcript-file` 回填。音频输入不可用或转写失败时，Agent 使用同一 `jobId` 执行 `--local-whisper`。成功响应以 `transcription.engine` 标明 `agent` 或 `local-whisper`。若同时请求了 `--data`，结束步骤将口播填入 JSON 和 CSV。

本地路径使用 Whisper Base q8。首次运行时校验并下载约 80 MB 模型，缓存于工具的 `.runtime/models/`。模型文件依次尝试 Hugging Face 和 ModelScope，并按固定校验和验证。缓存就绪后可离线转写，音频留在本机。

任务和临时音轨保存在工具的 `.runtime/transcription/`，可在不同进程完成。本地识别失败后仍可重试或提交 Agent 文本。仅返回标点或单个拉丁字母时提示 `SPEECH_UNCLEAR`，任务保留。`--finish-transcription '<jobId>' --skip-transcription` 用于跳过口播并导出请求的数据，口播字段为空。完成或跳过后清除临时文件。显式选择 `--audio` 导出的 WAV 作为成品保留。

## 登录与采集数据

链接任务启动独立的临时 Chrome 会话。检测到未登录时，CLI 在 stderr 发出一行 JSON，包含 `event: "yuanbao_login_required"`、中文 `message` 和 `waitMs`。在打开的窗口中手动登录腾讯元宝后，同一进程自动继续。账号登录凭据由 Chrome 持有。分享预览使用短效参数，平台和媒体导出排除临时授权地址。读取公开预览补采失败时，平台主响应中已取得的字段仍可保存。评论正文与平台推荐量记录为未返回。

独立标题、发布文案和识别口播分列。发布时间按北京时间展示，同时保留 Unix 秒。拇指赞、爱心、评论总数和转发采用平台的显示值，保留 `0` 和 `1万+`，未返回的字段在 JSON 中为 `null`、在 CSV 中为空。只导出链接平台数据时，根据接口返回内容记录可用版本。添加媒体处理后会补充实际媒体规格。

## 验证

```sh
npm test
npm run check
```

测试使用本机 Chrome 和模拟上游验证登录提醒与续跑、默认版本、公开预览补采、签名过滤和文件落盘。2026-11-19 用真实分享链接验证了元宝登录提醒、手动登录后自动续跑和 H.264 MP4 落盘，并用 ffprobe 核对成品。合成媒体覆盖本地导入、实际格式转换、两条路径交接、文本回填和跳过、重名以及部分导出失败。

已用真实 Whisper Base q8 离线识别合成中文口播并核对 TXT、JSON、CSV。已下载的视频样片触发 `SPEECH_UNCLEAR`，保留任务以供重试。Agent 文本回填已验证，Agent 模型本身的转写效果仍待验收。

来源和许可证见 [NOTICE.md](NOTICE.md)。
