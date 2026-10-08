export async function mapLimit(items, limit, fn) {
  const result = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        result[index] = await fn(items[index], index);
      }
    }),
  );
  return result;
}

export async function paginate(
  fetchPage,
  itemKey,
  tokenKey = "NextToken",
  inputKey = tokenKey,
) {
  const items = [];
  let token;
  const seen = new Set();
  do {
    const r = await fetchPage(token ? { [inputKey]: token } : {});
    items.push(...(r[itemKey] || []));
    token = r[tokenKey];
    if (token && seen.has(token))
      throw new Error("AWS 返回重复分页标记，请刷新重试");
    seen.add(token);
  } while (token);
  return items;
}

export function error(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function scrubError(e) {
  let text = e?.message || "AWS 请求失败";
  text = text
    .replace(/(?:AKIA|ASIA)[A-Z0-9]{16}/g, "[REDACTED]")
    .replace(
      /(TokenValue|secretAccessKey|sessionToken)[=: ]+[^ ,\n]+/gi,
      "$1=[REDACTED]",
    );
  return `${e?.name && e.name !== "Error" ? e.name + ": " : ""}${text}`;
}
