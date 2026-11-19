let converter;

export async function simplifyChinese(text) {
  if (!text) return "";
  converter ??= import("opencc-js/t2cn")
    .then(({ default: opencc }) => opencc.Converter({ from: "t", to: "cn" }));
  return (await converter)(text);
}
