import { link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";

export async function inTemporaryDirectory(directory, work) {
  await mkdir(directory, { recursive: true });
  const temporary = await mkdtemp(join(directory, ".weixin-download-"));
  try {
    return await work(temporary);
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => {});
  }
}

export async function publishFile(temporaryFile, directory, name) {
  const extension = extname(name);
  const stem = basename(name, extension);
  for (let index = 0; ; index++) {
    const path = join(directory, index ? `${stem} (${index})${extension}` : name);
    try {
      await link(temporaryFile, path);
      return path;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
  }
}

export async function saveText(directory, name, content) {
  return inTemporaryDirectory(directory, async (temporary) => {
    const staged = join(temporary, "text.part");
    await writeFile(staged, content, { flag: "wx", mode: 0o600 });
    return publishFile(staged, directory, name);
  });
}
