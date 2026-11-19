// Adapted from the isolated Chrome extension at 61d66f97. See NOTICE.md.
import { videoFileLabel } from "./filename.mjs";
import { mergeFeedMetadata, readFeedMetadata } from "./metadata.mjs";

export const YUANBAO_ORIGIN = "https://yuanbao.tencent.com";
export const CHANNELS_ORIGIN = "https://channels.weixin.qq.com";
export const USER_INFO = "/api/getuserinfo";
export const PARSE_RESULT = "/api/weixin/get_parse_result";

const FEED_PAGE = CHANNELS_ORIGIN + "/finder-preview/pages/feed";
const PUBLIC_PAGE = CHANNELS_ORIGIN + "/finder-preview/pages/sph";
const FEED_API = CHANNELS_ORIGIN + "/finder-preview/api/feed/get_feed_info";

export class DownloadError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function validateShareUrl(input) {
  try {
    const url = new URL(input.trim());
    const id = decodeURIComponent(url.pathname.match(/^\/sph\/([^/]+)\/?$/u)?.[1] ?? "");
    if (url.origin === "https://weixin.qq.com" && !url.username && !url.password &&
        !url.hash && id && !/[\s/\\\p{Cc}]/u.test(id)) return url.href;
  } catch {
    // Report one stable error for malformed inputs.
  }
  throw new DownloadError("INVALID_URL", "请输入一条有效的 https://weixin.qq.com/sph/… 分享链接。");
}

export function mediaAddress(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    const isVideoHost = url.hostname === "video.qq.com" || url.hostname.endsWith(".video.qq.com");
    if (url.protocol === "https:" && isVideoHost && !url.port &&
        !url.username && !url.password && !url.hash) return url;
  } catch {
    // A malformed address cannot be used as a media candidate.
  }
  return null;
}

function feedUrl(page) {
  const random = Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0");
  const requestId = `${Math.floor(Date.now() / 1000).toString(16)}-${random}`;
  const url = new URL(FEED_API);
  url.searchParams.set("_rid", requestId);
  url.searchParams.set("_pageUrl", page);
  return url;
}

function previewRequest(playableUrl) {
  let preview;
  try {
    preview = new URL(playableUrl);
  } catch {
    throw new DownloadError("UPSTREAM_RESPONSE", "元宝没有返回有效的视频号预览地址。");
  }

  const generalToken = preview.searchParams.get("token");
  const exportId = preview.searchParams.get("eid");
  if (!generalToken || !exportId) {
    throw new DownloadError("UPSTREAM_RESPONSE", "元宝返回的视频号预览缺少必要参数。");
  }

  const referer = new URL(FEED_PAGE);
  referer.search = new URLSearchParams({
    entry_card_type: "48",
    comment_scene: "39",
    appid: "0",
    token: generalToken,
    entry_scene: "0",
    eid: exportId,
  }).toString();

  return {
    url: feedUrl(FEED_PAGE),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      origin: CHANNELS_ORIGIN,
      referer: referer.href,
    },
    body: JSON.stringify({ baseReq: { generalToken }, exportId }),
  };
}

async function readFeed({ url, headers, body }, { fetchImpl, signal }) {
  const timeout = AbortSignal.timeout(15_000);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers,
      body,
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.any([signal, timeout]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new DownloadError("UPSTREAM_HTTP", `视频号分享预览请求失败（HTTP ${response.status}）。`);
    }
    return await response.json();
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof DownloadError) throw error;
    if (error instanceof SyntaxError) {
      throw new DownloadError("UPSTREAM_RESPONSE", "视频号分享预览返回了无效的数据。");
    }
    throw new DownloadError("UPSTREAM_NETWORK", timeout.aborted
      ? "视频号分享预览请求超时。"
      : "无法访问视频号分享预览，请检查网络后重试。");
  }
}

async function supplementMetadata(result, network) {
  const { metadata } = result;
  if (metadata.publicationEpoch !== null && metadata.description && metadata.shortTitle &&
      result.author && metadata.avatarUrl && result.coverUrl && Object.values(metadata.metrics).every(Boolean)) {
    return "未需补采";
  }
  const shortcode = new URL(result.sourceUrl).pathname.split("/")[2];
  if (!/^[A-Za-z0-9_-]+$/u.test(shortcode)) return "未尝试";
  const referer = new URL(PUBLIC_PAGE);
  referer.searchParams.set("id", shortcode);
  try {
    const publicFeed = await readFeed({
      url: feedUrl(PUBLIC_PAGE),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        origin: CHANNELS_ORIGIN,
        referer: referer.href,
      },
      body: JSON.stringify({ baseReq: { generalToken: "" }, shortUri: shortcode }),
    }, network);
    if (publicFeed?.errCode !== 0 || !publicFeed.data?.feedInfo) return "补采不可用";
    const { feedInfo, authorInfo } = publicFeed.data;
    result.metadata = mergeFeedMetadata(metadata, readFeedMetadata(feedInfo, authorInfo));
    result.author ||= stringValue(authorInfo?.nickname);
    result.coverUrl ||= stringValue(feedInfo.coverUrl);
    return "已读取公开预览";
  } catch {
    network.signal.throwIfAborted();
    return "补采不可用";
  }
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

function shareUrlWithoutQuery(shareUrl) {
  const url = new URL(shareUrl);
  return url.origin + url.pathname;
}

export async function parseShareLink(shareUrl, browser, network, {
  requireMedia = true,
  enrich = false,
} = {}) {
  const { status, data } = await browser.parse(shareUrl);
  if (status === 401) {
    throw new DownloadError("AUTH_EXPIRED", "元宝会话已失效，请重新运行并在 Chrome 中登录。");
  }
  if (status < 200 || status >= 300) {
    throw new DownloadError("UPSTREAM_HTTP", `元宝分享解析请求失败（HTTP ${status}）。`);
  }
  if (!data || (data.code !== undefined && data.code !== 0)) {
    throw new DownloadError("UPSTREAM_RESPONSE", "元宝未能解析此分享链接，请核对链接后重试。");
  }

  const feed = await readFeed(previewRequest(data.playableUrl), network);
  const issue = feed?.data?.errMsg;
  if ((Number.isInteger(feed?.errCode) && feed.errCode !== 0) ||
      (issue?.type || issue?.title?.trim?.() || issue?.content?.trim?.())) {
    throw new DownloadError("FEED_UNAVAILABLE", "视频号分享预览不可用，视频可能已删除或限制访问。");
  }

  const info = feed?.data?.feedInfo;
  if (!info || typeof info !== "object" || Array.isArray(info)) {
    throw new DownloadError("UPSTREAM_RESPONSE", "视频号分享预览缺少视频详情。");
  }

  const candidates = [
    ["H.264", info.h264VideoInfo?.videoUrl],
    ["通用", info.videoUrl],
    ["H.265", info.h265VideoInfo?.videoUrl],
  ];
  const mediaVariants = new Map();
  for (const [version, value] of candidates) {
    const address = mediaAddress(value);
    if (address && !mediaVariants.has(address.href)) mediaVariants.set(address.href, { address, version });
  }
  const media = mediaVariants.values().next().value;
  let mediaError;
  if (!media) {
    mediaError = candidates.some(([, value]) => value != null && value !== "")
      ? new DownloadError("MEDIA_URL_UNSUPPORTED", "视频号返回的媒体地址超出此工具支持的腾讯视频来源。")
      : new DownloadError("FEED_UNAVAILABLE", "视频号分享预览没有返回可下载的视频。");
    if (requireMedia) throw mediaError;
  }

  const author = feed.data.authorInfo;
  const cover = Array.isArray(info.picInfo) ? info.picInfo.find((item) => item?.url)?.url : "";
  const result = {
    sourceUrl: shareUrlWithoutQuery(shareUrl),
    metadata: readFeedMetadata(info, author, data.description),
    author: stringValue(author?.nickname) || stringValue(data.author),
    coverUrl: stringValue(info.coverUrl) || stringValue(data.coverUrl) || stringValue(cover),
    variants: Array.from(mediaVariants.values(), (variant) => variant.version),
    collectedAt: new Date().toISOString(),
    ...media,
    mediaError,
  };
  if (enrich) result.publicPreviewStatus = await supplementMetadata(result, network);
  result.title = videoFileLabel(result.metadata.shortTitle, result.sourceUrl);
  return result;
}
