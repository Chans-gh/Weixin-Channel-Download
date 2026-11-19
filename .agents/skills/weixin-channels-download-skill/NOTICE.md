# 来源与许可

分享链接解析、媒体版本顺序和文件命名源于本仓库独立 Chrome 扩展基线 `61d66f97`。独立标题、发布与互动字段、Whisper 模型校验清单与中文口播文本整理改编自同一扩展的 `ad1487f0`。本工具增加 Node CLI、本机文件处理、转写交接及 JSON 和 CSV 导出。

原扩展改编自 [MC0571/weixin-channels-video extension-v0.2.6](https://github.com/MC0571/weixin-channels-video/tree/extension-v0.2.6)，上游提交为 `b9c50529ebee1d7545a8245c22b719b53abaf76e`。适用的完整许可见 [Apache License 2.0](LICENSE)。

本地识别使用 [Xenova 的多语言 Whisper Base 模型](https://huggingface.co/Xenova/whisper-base/tree/64da57285918e20ea79ea5c88eed7197933abaa8)，上游按 Apache 2.0 提供。Playwright Core、[Transformers.js 4.3.2](https://github.com/huggingface/transformers.js/tree/4.3.2)、[OpenCC JS 1.4.2](https://www.npmjs.com/package/opencc-js/v/1.4.2) 及其第三方依赖通过 npm 独立安装，许可证和声明随软件包提供。FFmpeg 与 ffprobe 由运行环境提供。测试夹具由纯色视频和合成音调生成。
