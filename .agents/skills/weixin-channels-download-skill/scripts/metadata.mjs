// Adapted from the Chrome extension at ad1487f0. See NOTICE.md.
function text(value) {
  return typeof value === "string" && value.trim() ? value : "";
}

function httpAsset(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}

function count(value) {
  if (typeof value === "string") return value.trim();
  return Number.isSafeInteger(value) && value >= 0 ? String(value) : "";
}

export function independentTitle(title, description) {
  const value = text(title).trim();
  const comparable = input => text(input).normalize("NFKC").replace(/\s+/gu, "");
  return value && comparable(value) !== comparable(description) ? value : "";
}

export function readFeedMetadata(feed, author, fallbackDescription = "") {
  const timestamp = feed?.createtime;
  const epoch = typeof timestamp === "string" && /^\d+$/u.test(timestamp) ? Number(timestamp) : timestamp;
  const description = text(feed?.description) || text(fallbackDescription);
  return {
    description,
    shortTitle: independentTitle(feed?.title, description),
    publicationEpoch: Number.isSafeInteger(epoch) && epoch > 0 && epoch < 8_640_000_000_000 ? epoch : null,
    avatarUrl: httpAsset(author?.headImgUrl),
    badgeUrl: httpAsset(author?.authIconUrl),
    metrics: {
      thumbsUp: count(feed?.favCountFmt),
      heart: count(feed?.likeCountFmt),
      comments: count(feed?.commentCountFmt),
      forwards: count(feed?.forwardCountFmt),
    },
  };
}

export function mergeFeedMetadata(primary, supplement) {
  const description = primary.description || supplement.description;
  return {
    description,
    shortTitle: independentTitle(primary.shortTitle, description) || independentTitle(supplement.shortTitle, description),
    publicationEpoch: primary.publicationEpoch ?? supplement.publicationEpoch,
    avatarUrl: primary.avatarUrl || supplement.avatarUrl,
    badgeUrl: primary.badgeUrl || supplement.badgeUrl,
    metrics: Object.fromEntries(Object.entries(primary.metrics).map(([key, value]) => [key, value || supplement.metrics[key]])),
  };
}
