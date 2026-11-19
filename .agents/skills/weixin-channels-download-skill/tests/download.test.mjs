import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { test } from "node:test";
import { launchChrome, openYuanbao, waitForLogin } from "../scripts/browser.mjs";
import { mediaAddress, parseShareLink } from "../scripts/core.mjs";
import { runCli } from "../scripts/download.mjs";
import { saveVideo } from "../scripts/save-video.mjs";

const shareUrl = "https://weixin.qq.com/sph/fixture-video";
const fakePreview = "https://channels.weixin.qq.com/finder-preview/pages/feed?token=fixture-token&eid=fixture-eid";
const videoUrl = "https://finder.video.qq.com/fixture.mp4?signature=fixture-media";
const sample = await readFile(new URL("./fixtures/sample.mp4", import.meta.url));

function authResponse(loggedIn) {
  return {
    userId: loggedIn ? "fixture-account" : "",
    needRefreshToken: false,
    anonUser: { isAnon: !loggedIn },
  };
}

function upstreamFeed(media) {
  return Response.json({ errCode: 0, data: { feedInfo: media } });
}

async function tempOutput(t) {
  const dir = await mkdtemp(join(tmpdir(), "wx-skill-test-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

async function fixtureChrome(t, { loginMode = "authenticated", headless = true } = {}) {
  const chrome = await launchChrome({ headless });
  t.after(() => chrome.close());
  const requests = [];
  const pages = [];
  const browser = {
    close: () => chrome.close(),
    async newContext(options) {
      const context = await chrome.newContext({ ...options, serviceWorkers: "block", offline: true });
      context.on("page", page => pages.push(page));
      await context.route("**/*", async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== "https://yuanbao.tencent.com") return route.abort();

        const cookie = await request.headerValue("cookie");
        requests.push({ path: url.pathname, method: request.method(), cookie, data: request.postDataJSON() });
        switch (url.pathname) {
          case "/":
            return route.fulfill({
              contentType: "text/html; charset=utf-8",
              headers: loginMode === "authenticated" ? { "set-cookie": "fixture=1; Path=/; Secure; HttpOnly" } : {},
              body: '<p>模拟元宝登录</p><a href="/fixture-login">登录夹具</a>',
            });
          case "/fixture-login":
            return route.fulfill({
              headers: { "set-cookie": "fixture=1; Path=/; Secure; HttpOnly" },
              contentType: "text/html; charset=utf-8",
              body: "<p>模拟元宝已登录</p>",
            });
          case "/api/getuserinfo":
            if (loginMode === "broken") return route.fulfill({ status: 200, json: { changed: true } });
            return route.fulfill({ json: authResponse(cookie === "fixture=1") });
          case "/api/weixin/get_parse_result":
            return route.fulfill(cookie === "fixture=1"
              ? { json: { code: 0, data: { playable_url: fakePreview } } }
              : { status: 401, json: {} });
          default:
            return route.abort();
        }
      });
      return context;
    },
  };
  return { browser, requests, pages };
}

test("真实 Chrome 夹具经 CLI 提示登录，登录后保存完整的默认视频并返回路径", { timeout: 30_000 }, async (t) => {
  const dir = await tempOutput(t);
  const { browser, requests, pages } = await fixtureChrome(t, {
    loginMode: "anonymous",
    headless: process.env.WX_FIXTURE_HEADED !== "1",
  });
  const stdout = [];
  const stderr = [];
  const network = [];
  let login;
  const fetchImpl = async (url, init) => {
    network.push(url.href);
    assert.equal(init.credentials, "omit");
    assert.equal(new Headers(init.headers).has("cookie"), false);
    if (url.hostname === "channels.weixin.qq.com") {
      assert.equal(init.method, "POST");
      assert.equal(url.pathname, "/finder-preview/api/feed/get_feed_info");
      assert.match(url.searchParams.get("_rid"), /^[0-9a-f]+-[0-9a-f]{8}$/u);
      const referer = new URL(init.headers.referer);
      assert.equal(referer.searchParams.get("token"), "fixture-token");
      assert.equal(referer.searchParams.get("eid"), "fixture-eid");
      assert.deepEqual(JSON.parse(init.body), { baseReq: { generalToken: "fixture-token" }, exportId: "fixture-eid" });
      return upstreamFeed({
        description: "夹具视频",
        h264VideoInfo: { videoUrl },
        videoUrl: "https://finder.video.qq.com/other.mp4",
      });
    }
    assert.equal(url.href, videoUrl);
    return new Response(sample, { headers: { "content-length": String(sample.length) } });
  };
  const exitCode = await runCli([shareUrl, "--output-dir", dir], {
    launch: async () => browser,
    fetchImpl,
    stdout: { write: (line) => stdout.push(line) },
    stderr: {
      write(line) {
        stderr.push(line);
        login = pages[0].getByRole("link", { name: "登录夹具" }).click();
      },
    },
  });
  await login;
  assert.equal(exitCode, 0, stdout.join(""));
  assert.equal(stderr.length, 1);
  const event = JSON.parse(stderr[0]);
  assert.equal(event.event, "yuanbao_login_required");
  assert.equal(event.waitMs, 180_000);
  assert.match(event.message, /手动登录腾讯元宝/u);
  const result = JSON.parse(stdout.join(""));
  assert.deepEqual(Object.keys(result), ["ok", "path", "bytes", "version"]);
  assert.equal(result.ok, true);
  assert.equal(result.version, "H.264");
  assert.equal(result.bytes, sample.length);
  assert.ok(isAbsolute(result.path));
  assert.deepEqual(await readFile(result.path), sample);
  assert.equal((await readdir(dir)).length, 1);
  assert.equal(network.length, 2);
  assert.ok(requests.some(({ path, cookie }) => path === "/api/getuserinfo" && cookie === null));
  assert.ok(requests.some(({ path, cookie }) => path === "/api/getuserinfo" && cookie === "fixture=1"));
  assert.ok(requests.some(({ path, cookie, method, data }) => path === "/api/weixin/get_parse_result" &&
    cookie === "fixture=1" && method === "POST" && data.type === "video_channel_url" &&
    data.url === shareUrl && data.scene === 1));
});

test("Chrome 夹具在用户登录后继续，并区分登录超时和上游格式变化", { timeout: 30_000 }, async (t) => {
  const signal = new AbortController().signal;
  const { browser } = await fixtureChrome(t, { loginMode: "anonymous" });
  const { page } = await openYuanbao(browser);
  let prompted = 0;
  await assert.rejects(waitForLogin(page, {
    signal, waitMs: 10, intervalMs: 10,
    onLoginRequired: () => { prompted++; },
  }), { code: "LOGIN_REQUIRED" });
  await waitForLogin(page, {
    signal, waitMs: 5000, intervalMs: 30,
    onLoginRequired: async () => {
      prompted++;
      await page.getByRole("link", { name: "登录夹具" }).click();
      assert.equal(new URL(page.url()).pathname, "/fixture-login");
    },
  });
  assert.equal(prompted, 2);

  const broken = await fixtureChrome(t, { loginMode: "broken" });
  const failed = await openYuanbao(broken.browser);
  await assert.rejects(waitForLogin(failed.page, {
    signal,
    onLoginRequired: () => assert.fail("格式变化不应提示重新登录"),
  }), { code: "LOGIN_CHECK_FAILED" });
});

test("CLI 拒绝伪造主机、非法路径和多条链接，且不会启动浏览器", async () => {
  for (const [args, code] of [
    [["https://weixin.qq.com.example/sph/fixture"], "INVALID_URL"],
    [["https://weixin.qq.com:8443/sph/fixture"], "INVALID_URL"],
    [["https://weixin.qq.com/sph/a%2Fb"], "INVALID_URL"],
    [[shareUrl, shareUrl], "INVALID_ARGUMENTS"],
  ]) {
    const output = [];
    let launched = false;
    const status = await runCli(args, {
      launch: () => { launched = true; },
      stdout: { write: (line) => output.push(JSON.parse(line)) },
    });
    assert.equal(launched, false);
    assert.equal(status, 1);
    assert.equal(output[0].code, code);
  }
});

test("默认顺序使用通用或 H.265，并拒绝不可用视频及异常预览", async () => {
  const parse = (playableUrl) => async () => ({ status: 200, data: { playableUrl } });
  const network = { signal: new AbortController().signal };
  const cases = [
    [{ h264VideoInfo: {}, videoUrl, h265VideoInfo: { videoUrl } }, "通用"],
    [{ videoUrl: "", h265VideoInfo: { videoUrl } }, "H.265"],
  ];
  for (const [info, version] of cases) {
    const result = await parseShareLink(shareUrl, { parse: parse(fakePreview) }, {
      ...network,
      fetchImpl: async () => upstreamFeed(info),
    });
    assert.equal(result.version, version);
  }
  await assert.rejects(parseShareLink(shareUrl, { parse: parse(fakePreview) }, {
    ...network,
    fetchImpl: async () => upstreamFeed({}),
  }), { code: "FEED_UNAVAILABLE" });
  await assert.rejects(parseShareLink(shareUrl, { parse: parse(fakePreview) }, {
    ...network,
    fetchImpl: async () => new Response("", { status: 403 }),
  }), { code: "UPSTREAM_HTTP" });
  await assert.rejects(parseShareLink(shareUrl, { parse: parse("https://example.com/?eid=fixture") }, {
    ...network,
    fetchImpl: async () => assert.fail("缺少参数时应在发送请求前停止"),
  }), { code: "UPSTREAM_RESPONSE" });
});

test("并发下载同一标题时两份文件都能完整保存", async (t) => {
  const dir = await tempOutput(t);
  const media = { address: mediaAddress(videoUrl), title: "同标题", version: "H.264" };
  const network = {
    signal: new AbortController().signal,
    fetchImpl: async () => new Response(sample),
  };
  const [first, second] = await Promise.all([
    saveVideo(media, dir, network),
    saveVideo(media, dir, network),
  ]);
  assert.notEqual(first.path, second.path);
  assert.deepEqual(await readFile(first.path), sample);
  assert.deepEqual(await readFile(second.path), sample);
  assert.equal((await readdir(dir)).length, 2);
});

test("拦截跨域跳转，非 MP4、截断和中断均不留下成品或临时文件", async (t) => {
  const dir = await tempOutput(t);
  const media = { address: mediaAddress(videoUrl), title: "下载失败", version: "H.264" };
  const responses = [
    [() => new Response("", { status: 302, headers: { location: "https://video.qq.com.example/" } }), "DOWNLOAD_REDIRECT"],
    [() => new Response("网页"), "INVALID_MEDIA"],
    [() => new Response(sample.subarray(0, -5), { headers: { "content-length": String(sample.length) } }), "INCOMPLETE_DOWNLOAD"],
    [() => new Response(sample.subarray(0, -5)), "INVALID_MEDIA"],
    [() => new Response(new ReadableStream({ start(stream) { stream.error(new Error("fixture-network")); } })), "DOWNLOAD_FAILED"],
  ];
  for (const [makeResponse, code] of responses) {
    let requests = 0;
    await assert.rejects(saveVideo(media, dir, {
      signal: new AbortController().signal,
      fetchImpl: async () => {
        assert.equal(++requests, 1);
        return makeResponse();
      },
    }), { code });
    assert.deepEqual(await readdir(dir), []);
  }
});

test("Chrome 链接夹具按需补采独立标题和互动，数据导出不包含签名地址", { timeout: 30_000 }, async (t) => {
  const dir = await tempOutput(t);
  const { browser } = await fixtureChrome(t);
  const outputs = [];
  let primary = 0;
  let supplement = 0;
  const description = ' =正文含"引号"\n#视频号';
  const status = await runCli([shareUrl + "?token=fixture-private-source", "--data", "--output-dir", dir], {
    launch: async () => browser,
    stdout: { write: (line) => outputs.push(JSON.parse(line)) },
    fetchImpl: async (url, init) => {
      assert.equal(url.hostname, "channels.weixin.qq.com");
      assert.equal(init.credentials, "omit");
      const request = JSON.parse(init.body);
      if (request.baseReq.generalToken) {
        primary++;
        return upstreamFeed({
          description,
          title: description,
          likeCountFmt: "1万+",
          coverUrl: "https://wx.example/cover?signature=fixture-cover",
          videoUrl,
        });
      }
      supplement++;
      assert.equal(new URL(init.headers.referer).pathname, "/finder-preview/pages/sph");
      assert.equal(request.shortUri, "fixture-video");
      return Response.json({
        errCode: 0,
        data: {
          feedInfo: { title: "独立标题", createtime: 1784505600, favCountFmt: 0, commentCountFmt: "12" },
          authorInfo: { nickname: "示例作者", headImgUrl: "https://wx.example/avatar" },
        },
      });
    },
  });
  assert.equal(status, 0, JSON.stringify(outputs[0]));
  assert.equal(primary, 1);
  assert.equal(supplement, 1);
  const { json, csv } = outputs[0].outputs.data;
  assert.match(json, /独立标题/u);
  const raw = await readFile(json, "utf8");
  const data = JSON.parse(raw);
  assert.equal(data.sourceUrl, shareUrl);
  assert.equal(data.description, description);
  assert.deepEqual(data.hashtags, ["#视频号"]);
  assert.equal(data.title, "独立标题");
  assert.equal(data.publishedAt, "2026-07-20 08:00:00");
  assert.equal(data.author, "示例作者");
  assert.equal(data.avatarUrl, "https://wx.example/avatar");
  assert.equal(data.coverUrl, null);
  assert.equal(data.coverStatus, "可预览");
  assert.equal(data.thumbsUp, "0");
  assert.equal(data.heart, "1万+");
  assert.equal(data.comments, "12");
  assert.equal(data.forwards, null);
  assert.equal(data.commentTextStatus, "未返回");
  assert.equal(data.publicPreviewStatus, "已读取公开预览");
  assert.ok(!/fixture-(?:private-source|cover|media|token)/u.test(raw));
  const table = await readFile(csv, "utf8");
  assert.ok(table.includes('"独立标题"'));
  assert.ok(table.includes(`"' =正文含""引号""\n#视频号"`));
  assert.equal((await readdir(dir)).length, 2);
});

test("补采不可用时保留主响应已有字段，缺标题时文件名使用短链编号", async () => {
  const share = await parseShareLink(shareUrl, {
    parse: async () => ({ status: 200, data: { playableUrl: fakePreview } }),
  }, {
    signal: new AbortController().signal,
    fetchImpl: async (url) => url.searchParams.get("_pageUrl").endsWith("/sph")
      ? new Response(null, { status: 503 })
      : upstreamFeed({ title: " 发布文案", description: "发布文案", favCountFmt: "4" }),
  }, { requireMedia: false, enrich: true });
  assert.equal(share.title, "视频号_fixture-video");
  assert.equal(share.metadata.shortTitle, "");
  assert.equal(share.metadata.metrics.thumbsUp, "4");
  assert.equal(share.mediaError.code, "FEED_UNAVAILABLE");
  assert.equal(share.publicPreviewStatus, "补采不可用");
});

test("只导出链接音轨时使用临时 MP4，音轨缺失仍能保存分享数据", { timeout: 30_000 }, async (t) => {
  const directory = await tempOutput(t);
  const { browser } = await fixtureChrome(t);
  const lines = [];
  let mediaRequests = 0;
  const status = await runCli([shareUrl, "--audio", "--data", "--output-dir", directory], {
    launch: async () => browser,
    stdout: { write: line => lines.push(JSON.parse(line)) },
    fetchImpl: async (url) => {
      if (url.hostname === "channels.weixin.qq.com") {
        return upstreamFeed({ title: "独立标题", description: "发布文案", videoUrl });
      }
      assert.equal(url.href, videoUrl);
      mediaRequests++;
      return new Response(sample);
    },
  });
  assert.equal(status, 1);
  assert.equal(mediaRequests, 1);
  const [result] = lines;
  assert.equal(result.errors.audio.code, "AUDIO_TRACK_MISSING");
  assert.deepEqual(Object.keys(result.outputs), ["data"]);
  const record = JSON.parse(await readFile(result.outputs.data.json, "utf8"));
  assert.equal(record.videoCodec, "h264");
  assert.equal(record.audioCodec, null);
  assert.ok(record.duration > 0);
  assert.equal((await readdir(directory)).length, 2);
});
