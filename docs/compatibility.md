# 宿主适配与发行包

[使用指南](usage.md) · [查看发行版](https://github.com/Chans-gh/Weixin-Channel-Download/releases/latest)

三个安装包都来自同一份 `.agents/skills/weixin-channels-download-skill/`。WorkBuddy 包增加中英文介绍、示例、版本和作者。Codex 包增加展示元数据。DeepSeek Harness 使用原生 Agent Skills 目录结构。

每个 ZIP 包含一个名为 `weixin-channels-download-skill` 的根文件夹。运行时依赖根据锁文件安装。FFmpeg、Chrome 和 Whisper 模型由本机环境提供。GitHub Release 提供独立的 SHA-256 校验清单。

## 安装与行为检查

| 项目 | 证据 |
| --- | --- |
| WorkBuddy | 核对 ZIP、YAML 必填字段，并在 5.11.3 客户端确认上传入口。本机导入未执行 |
| DeepSeek Harness | 用 macOS 0.2.2-rc.3 自带的文件系统加载器，从解压目录发现并读出了 Skill 正文 |
| Codex | 本机 Codex app-server 从解压目录发现了 Skill，并返回已启用状态与展示元数据 |
| 共用 CLI | 18 项源码测试通过，覆盖下载夹具、音轨、导入导出与转写切换。真实 MP4 下载及 Whisper 离线识别曾在 macOS 验证 |

以上记录来自 v0.2.0 的 macOS 验证。Agent 文本回填已通过测试，宿主原生识别效果尚待验收。原生音频能力取决于会话中的模型和工具。此前实测的 Codex + GPT‑6.2 Sol 会话返回音频输入不可用，该会话可用本地 Whisper 继续。

## 构建

在仓库根目录运行 `python3 scripts/package_release.py`。脚本从技能 `package.json` 读取版本，把 ZIP 和 `SHA256SUMS.txt` 写入 `dist/`。在 `dist/` 中运行 `shasum -a 256 -c SHA256SUMS.txt` 可复核。

规范来源

- [WorkBuddy 技能规范](https://open.workbuddy.cn/docs/skill)
- [DeepSeek Harness 本地 Skill 规范](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/skills.md#local-discovery-priority)
- [Codex Skill 发现和元数据规范](https://learn.chatgpt.com/docs/build-skills)
