---
name: weixin-channels-download-skill
description: 处理一条微信视频号分享链接或一个本地音视频。按需下载和导出 MP4、提取 WAV、优先由 Agent 转写中文口播并用本地 Whisper 兜底，或导出视频号发布数据和本地媒体规格。
---

# 视频号媒体与数据

在本 Skill 目录执行脚本，传入用户提供的一条 `https://weixin.qq.com/sph/…` 链接或一个本地文件路径。

1. 运行 `node scripts/download.mjs '<链接或本地文件>'`。按需选用 `--video`（MP4）、`--audio`（48 kHz、16 位 PCM WAV）、`--data`（JSON 和 CSV）和 `--transcribe`（简体口播），四项都需要时用 `--all`。省略选项时，链接默认下载 MP4，本地文件默认导出媒体数据。默认保存到 Downloads，可用 `--output-dir '目录'` 指定位置。首次使用需要 Node.js 24+，在本目录运行 `npm ci --ignore-scripts`。本地媒体与音轨处理需要 FFmpeg 和 ffprobe。
2. 链接任务使用可持续读取进程输出的执行工具。stderr 出现 `yuanbao_login_required` 时，立即把 `message` 转告用户，提醒在打开的 Chrome 窗口手动登录，继续轮询原进程。等待时间以 `waitMs` 为准。stdout 在进程结束时返回结果。
3. 收到 `transcription.status: "pending"` 时，用返回的 `jobId` 完成口播：
   - **优先用 Agent。** 当前会话有已确认的原生音频输入时，把 `audioPath` 交给该能力，逐字转写音频。把纯文本写入 UTF-8 临时文件，再运行 `node scripts/download.mjs --finish-transcription '<jobId>' --transcript-file '<临时文本路径>'`。模型目录里的能力标记只用于参考，以会话实际可用的音频入口为准。
   - **失败时用本地 Whisper。** 会话缺少音频入口、返回 `Audio input is not available` 或未得到可用的转写时，直接运行 `node scripts/download.mjs --finish-transcription '<jobId>' --local-whisper`。使用同一任务，首次需要下载校验约 80 MB 模型，音频在本机识别。当前 Codex + GPT‑6.2 Sol 会话若遇到上述音频限制，直接走此路径。常规工具输出只传递文件路径和状态。
   - Whisper 失败时保留任务编号，随后可重试或使用有音频能力的 Agent 完成。用户选择跳过口播时，执行 `node scripts/download.mjs --finish-transcription '<jobId>' --skip-transcription` 以完成请求中的数据导出。
4. 单独下载时回报 `path`、`bytes`、`version`。组合操作合并两次 `outputs`，并用结果里的 `transcription.engine` 回报实际转写方式。若 `ok` 为 false，仍使用已有成品和待转写任务，并回报失败项。发布文案和识别口播稿分别处理。

命令、字段和验证范围见 [README](README.md)。
