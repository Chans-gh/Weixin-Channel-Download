// Adapted from the Chrome extension at ad1487f0. See NOTICE.md.
import { simplifyChinese } from "./simplified-chinese.mjs";

const han = /\p{Script=Han}/u;
const wordSegmenter = new Intl.Segmenter("zh", { granularity: "word" });

// Read URLs and punctuation before considering spoken clause boundaries.
const cues = new RegExp([
  /https?:\/\/[^\s\p{Script=Han}，。！？、]+/u,
  /(?<sentence>(?:[。！？!?]+|\.(?=\s|$)|(?<=\p{Script=Han})\.(?=\p{Script=Han}))[”’」』）】"')\]]*)/u,
  /(?<clause>[，、；：]|[,;:](?=\s|\p{Script=Han}|$))/u,
  /(?<particle>[吗嗎])(?=\p{Script=Han})/u,
  /(?<transition>[为為]什[么麼]|有[谁誰]|如果|要是|因[为為]|但是|不[过過]|所以|因此|首先|其次|然[后後]|接下[来來]|最[后後]|也就是[说說]|也[许許]|(?:[你您我他她它咱]|我[们們])(?=就|才))(?=\p{Script=Han})/u,
].map(pattern => pattern.source).join("|"), "gu");
const question = /^(?:[为為]什[么麼]|有[谁誰]|[请請][问問]|[你您](?:能不能|是不是))|[吗嗎]$/u;
const questionLead = /^(?:[为為]什[么麼]|有[谁誰])$/u;
const indirectQuestion = /(?:知道|想[问問]|不懂|明白|理解|[问問](?:他|她)?|解[释釋]|[发现發現])$/u;
const topic = /^(?:首先|其次|接下[来來]|最[后後]|所以|因此)$/u;
const conditionalReply = /^(?:[你您我他她它咱]|我[们們])$/u;

function addPunctuation(text) {
  let output = "";
  let copied = 0;
  let sentenceStart = 0;
  let clauseStart = 0;

  function append(end, mark) {
    output += text.slice(copied, end).trimEnd() + mark;
    copied = clauseStart = end;
    if (mark.endsWith("\n")) sentenceStart = end;
  }

  for (const match of text.matchAll(cues)) {
    const { sentence, clause, particle, transition } = match.groups;
    const start = match.index;
    const end = start + match[0].length;
    if (sentence) {
      append(end, "\n");
    } else if (clause) {
      clauseStart = end;
    } else if (particle && start - clauseStart >= 2) {
      append(end, "？\n");
    } else if (transition) {
      const before = text.slice(clauseStart, start).trim();
      if (before.length < 5 || !han.test(before)) continue;
      if (questionLead.test(transition) && indirectQuestion.test(before)) continue;
      if (conditionalReply.test(transition) && !/^(?:如果|要是)/u.test(before)) continue;
      if (question.test(before)) append(start, "？\n");
      else append(start, topic.test(transition) && start - sentenceStart >= 18 ? "。\n" : "，");
    }
  }

  const rest = text.slice(copied).trim();
  if (rest) {
    const lastClause = text.slice(clauseStart).trim();
    const terminal = question.test(lastClause) ? "？" : "。";
    output += rest + (han.test(rest) && !/[，、；：,;:]$/u.test(rest) ? terminal : "");
  }
  return output.trimEnd();
}

function wrapLongLine(line) {
  if (line.length <= 56 || !han.test(line)) return line;
  const lines = [];
  let start = 0;
  let lastComma = 0;
  for (const { index, segment } of wordSegmenter.segment(line)) {
    if (index - start >= 46 && line.length - index >= 10) {
      const end = lastComma > start + 20 ? lastComma : index;
      lines.push(line.slice(start, end).trim());
      start = end;
    }
    if (/^[，、；,;]$/u.test(segment)) lastComma = index + segment.length;
  }
  lines.push(line.slice(start).trim());
  return lines.join("\n");
}

export function formatTranscript(text) {
  return (text?.trim() ?? "").split(/\r?\n/u)
    .map(line => addPunctuation(line.trim()))
    .join("\n")
    .split("\n")
    .map(wrapLongLine)
    .join("\n");
}

export async function prepareTranscript(text) {
  return formatTranscript(await simplifyChinese(text));
}
