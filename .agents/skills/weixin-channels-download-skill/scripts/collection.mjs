import { basename } from "node:path";
import { saveText } from "./files.mjs";

const beijing = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai", dateStyle: "short", timeStyle: "medium",
});

function publicResource(value) {
  const url = typeof value === "string" && URL.parse(value);
  return url && ["http:", "https:"].includes(url.protocol) && !url.username &&
    !url.password && !url.search && !url.hash ? url.href : null;
}

export function collectionRecord({ share, localFile, media, transcript, transcriptStatus }) {
  const meta = share?.metadata;
  const description = meta?.description || null;
  const hashtags = [...new Set(description?.match(/#[^#@\s，。！？；、]+/gu) ?? [])];
  const publishedEpoch = meta?.publicationEpoch ?? null;
  const savedAt = new Date().toISOString();
  const resolution = media?.video?.width && media?.video?.height
    ? `${media.video.width}×${media.video.height}`
    : "";
  const variants = share?.variants ?? [];
  return {
    source: share ? "视频号分享" : "本地导入",
    sourceUrl: share?.sourceUrl ?? null,
    fileName: localFile ?? null,
    collectedAt: share?.collectedAt ?? savedAt,
    savedAt,
    title: meta?.shortTitle || null,
    description,
    hashtags,
    publishedAt: publishedEpoch === null ? null : beijing.format(publishedEpoch * 1000),
    publishedEpoch,
    author: share?.author || null,
    avatarUrl: publicResource(meta?.avatarUrl),
    badgeUrl: publicResource(meta?.badgeUrl),
    coverStatus: share?.coverUrl ? "可预览" : "未返回",
    coverUrl: publicResource(share?.coverUrl),
    duration: media?.duration ?? null,
    width: media?.video?.width ?? null,
    height: media?.video?.height ?? null,
    videoCodec: media?.video?.codec ?? null,
    audioCodec: media?.audio?.codec ?? null,
    variants,
    specs: [resolution, variants.join(" / ")].filter(Boolean).join(" · ") || null,
    thumbsUp: meta?.metrics.thumbsUp || null,
    heart: meta?.metrics.heart || null,
    comments: meta?.metrics.comments || null,
    forwards: meta?.metrics.forwards || null,
    commentTextStatus: share ? "未返回" : null,
    platformRecommendationStatus: share ? "未返回" : null,
    publicPreviewStatus: share?.publicPreviewStatus ?? null,
    transcriptStatus,
    transcript,
  };
}

const COLUMNS = [
  ["sourceUrl", "来源链接"], ["collectedAt", "采集时间"], ["savedAt", "保存时间"],
  ["title", "显示标题"], ["title", "独立短标题"], ["description", "发布文案"], ["hashtags", "话题标签"],
  ["publishedAt", "发布时间"], ["publishedEpoch", "发布时间原值"],
  ["author", "作者昵称"], ["avatarUrl", "作者头像"], ["badgeUrl", "作者徽标"],
  ["coverStatus", "封面状态"], ["coverUrl", "封面链接"], ["duration", "时长（秒）"], ["specs", "视频规格"],
  ["thumbsUp", "拇指赞"], ["heart", "爱心"], ["comments", "评论数"], ["forwards", "转发"],
  ["commentTextStatus", "评论正文状态"], ["platformRecommendationStatus", "平台推荐量状态"],
  ["transcriptStatus", "转写状态"], ["transcript", "口播文案"],
  ["source", "来源"], ["fileName", "导入文件"],
  ["width", "宽度"], ["height", "高度"], ["videoCodec", "视频编码"], ["audioCodec", "音频编码"],
  ["variants", "可用版本"], ["publicPreviewStatus", "公开预览补采状态"],
];

function csvCell(value) {
  let text = Array.isArray(value) ? value.join(" / ") : String(value ?? "");
  if (/^(?:\s*[=+\-@＝＋－＠]|[\t\r\n])/u.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function encodeCollectionCsv(record) {
  const header = COLUMNS.map(([, label]) => csvCell(label)).join(",");
  const row = COLUMNS.map(([key]) => {
    const value = record[key];
    if (value && (key === "savedAt" || key === "collectedAt")) return csvCell(beijing.format(new Date(value)));
    if (key === "hashtags") return csvCell(value?.join(" "));
    return csvCell(value);
  }).join(",");
  return "\uFEFF" + header + "\r\n" + row + "\r\n";
}

export async function exportCollection(record, directory, stem, outputs) {
  outputs.json = await saveText(directory, stem + ".json", JSON.stringify(record, null, 2) + "\n");
  outputs.csv = await saveText(directory, basename(outputs.json, ".json") + ".csv", encodeCollectionCsv(record));
}
