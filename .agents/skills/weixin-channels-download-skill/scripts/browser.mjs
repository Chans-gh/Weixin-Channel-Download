import { setTimeout as delay } from "node:timers/promises";
import { DownloadError, PARSE_RESULT, USER_INFO, YUANBAO_ORIGIN } from "./core.mjs";

const LOGIN_WAIT_MS = 180_000;

export async function launchChrome({ headless = false } = {}) {
  let chromium;
  try {
    ({ chromium } = await import("playwright-core"));
  } catch {
    throw new DownloadError("DEPENDENCY_MISSING", "请先在 Skill 目录运行 npm ci --ignore-scripts。");
  }
  try {
    return await chromium.launch({
      channel: "chrome",
      headless,
      chromiumSandbox: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });
  } catch {
    throw new DownloadError("BROWSER_UNAVAILABLE", "无法启动本机 Google Chrome，请确认已安装且当前桌面可打开 Chrome。");
  }
}

async function fetchFromYuanbao(page, path, shareUrl) {
  try {
    return await page.evaluate(async ({ origin, path, shareUrl }) => {
      if (location.origin !== origin) return null;

      const init = {
        headers: { accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(12_000),
      };
      if (shareUrl) {
        init.method = "POST";
        init.headers["content-type"] = "application/json";
        init.body = JSON.stringify({ type: "video_channel_url", url: shareUrl, scene: 1 });
      }

      const response = await fetch(path, init);
      const status = response.status;
      if (!response.ok) return { status, data: null };
      const json = await response.json().catch(() => null);
      if (shareUrl) {
        return {
          status,
          data: json && {
            code: json.code,
            playableUrl: json.data?.playable_url,
            description: json.data?.desc,
            author: json.data?.author,
            coverUrl: json.data?.cover_url,
          },
        };
      }

      // Only an authentication state leaves the page.
      const data = typeof json?.userId === "string" &&
        typeof json.needRefreshToken === "boolean" &&
        typeof json.anonUser?.isAnon === "boolean"
        ? (json.userId.trim() && !json.needRefreshToken && !json.anonUser.isAnon
          ? "authenticated"
          : "anonymous")
        : null;
      return { status, data };
    }, { origin: YUANBAO_ORIGIN, path, shareUrl });
  } catch {
    return null;
  }
}

async function loginState(page) {
  const result = await fetchFromYuanbao(page, USER_INFO);
  if (result?.status === 401 || result?.status === 403) return "anonymous";
  return result?.data ?? "unavailable";
}

export async function waitForLogin(page, { signal, onLoginRequired, waitMs = LOGIN_WAIT_MS, intervalMs = 4000 }) {
  let state = await loginState(page);
  signal.throwIfAborted();
  if (state === "authenticated") return;
  if (state !== "anonymous") {
    throw new DownloadError("LOGIN_CHECK_FAILED", "无法确认元宝登录状态，请检查网络和元宝页面后重试。");
  }

  await onLoginRequired({ waitMs });
  const deadline = Date.now() + waitMs;
  while (!page.isClosed() && Date.now() < deadline) {
    await delay(Math.min(intervalMs, deadline - Date.now()), undefined, { signal });
    if (page.isClosed()) break;
    state = await loginState(page);
    signal.throwIfAborted();
    if (state === "authenticated") return;
  }
  if (state === "unavailable" && !page.isClosed()) {
    throw new DownloadError("LOGIN_CHECK_FAILED", "等待期间无法确认元宝登录状态，请检查网络后重试。");
  }
  throw new DownloadError("LOGIN_REQUIRED", "请重新运行，并在打开的 Chrome 窗口内手动完成元宝登录。");
}

export async function openYuanbao(browser) {
  try {
    const context = await browser.newContext({ acceptDownloads: false });
    const page = await context.newPage();
    await page.goto(YUANBAO_ORIGIN + "/", { waitUntil: "domcontentloaded", timeout: 25_000 });
    return {
      page,
      async parse(shareUrl) {
        const response = await fetchFromYuanbao(page, PARSE_RESULT, shareUrl);
        if (!response) {
          throw new DownloadError("UPSTREAM_NETWORK", "无法向元宝提交分享链接，请确认登录窗口仍打开并检查网络。");
        }
        return response;
      },
    };
  } catch {
    throw new DownloadError("BROWSER_NAVIGATION_FAILED", "Chrome 未能打开元宝，请检查网络后重试。");
  }
}
