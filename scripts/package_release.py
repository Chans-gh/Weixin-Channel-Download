#!/usr/bin/env python3
"""Build installable Skill archives from the repository's shared sources."""

import hashlib
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo


ROOT = Path(__file__).resolve().parents[1]
SKILL_NAME = "weixin-channels-download-skill"
SKILL = ROOT / ".agents" / "skills" / SKILL_NAME
OUTPUT = ROOT / "dist"
HOSTS = ("workbuddy", "deepseek-harness", "codex")
COMMON_FILES = ("SKILL.md", "README.md", "LICENSE", "NOTICE.md", "package.json", "package-lock.json")


def workbuddy_entry(entry, version):
    start, header, body = entry.split("---\n", 2)
    if start:
        raise ValueError("Expected YAML frontmatter at the start of SKILL.md")
    metadata = {
        "display_name": "微信视频号下载",
        "display_name_en": "Weixin Channel Download",
        "description_zh": "下载视频号 MP4，提取 WAV，转写中文口播并导出 JSON 和 CSV。",
        "description_en": "Download Weixin Channels videos, extract WAV, transcribe Mandarin speech, and export JSON or CSV.",
        "version": version,
        "author": "Chans-gh",
        "examples_zh": ["下载我提供的一条视频号分享链接。", "导入本地视频并提取中文口播。"],
        "examples_en": ["Download a Weixin Channels share link.", "Transcribe Mandarin speech from a local video."],
    }
    fields = "".join(f"{key}: {json.dumps(value, ensure_ascii=False)}\n" for key, value in metadata.items())
    return f"---\n{header}{fields}---\n{body}"


def archive_files(host, version):
    names = [*COMMON_FILES, *(path.relative_to(SKILL).as_posix() for path in sorted((SKILL / "scripts").glob("*.mjs")))]
    if host == "codex":
        names.append("agents/openai.yaml")
    files = {}
    for name in names:
        source = SKILL / name
        if not source.is_file() or source.is_symlink():
            raise ValueError(f"Expected a regular source file: {name}")
        files[f"{SKILL_NAME}/{name}"] = source.read_bytes()
    if host == "workbuddy":
        name = f"{SKILL_NAME}/SKILL.md"
        files[name] = workbuddy_entry(files[name].decode(), version).encode()
    return files


def build_archive(path, files):
    with ZipFile(path, "w") as archive:
        for name, data in sorted(files.items()):
            entry = ZipInfo(name)
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, data, compress_type=ZIP_DEFLATED)
    with ZipFile(path) as archive:
        actual = {name: archive.read(name) for name in archive.namelist()}
        if actual != files:
            raise ValueError(f"Archive verification failed: {path.name}")


def main():
    version = json.loads((SKILL / "package.json").read_text())["version"]
    OUTPUT.mkdir(exist_ok=True)
    checksums = []
    for host in HOSTS:
        path = OUTPUT / f"weixin-channel-download-{host}-v{version}.zip"
        build_archive(path, archive_files(host, version))
        checksums.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n")
        print(path.name)
    (OUTPUT / "SHA256SUMS.txt").write_text("".join(checksums))


if __name__ == "__main__":
    main()
