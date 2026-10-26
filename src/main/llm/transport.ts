export function endpoint(base: string, suffix: string) {
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash) throw new Error('Use a base URL without credentials, query parameters, or fragments.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Use HTTPS, or HTTP only for localhost.');
  return `${url.toString().replace(/\/$/, '')}/${suffix}`;
}
export async function boundedText(response: Response, maxBytes = 250000) {
  if (!response.body) throw new Error('Provider returned an empty response.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '', length = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new Error('Provider response exceeds the size limit.');
      text += decoder.decode(value, {stream: true});
    }
    return text + decoder.decode();
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
// Newline-delimited JSON, handling lines split across arbitrary network chunks.
export async function readLines(response: Response, onLine: (line: string) => void, maxBytes = 4_000_000) {
  if (!response.body) throw new Error('Provider returned an empty stream.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', bytes = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('Provider stream exceeds the size limit.');
      buffer += decoder.decode(value, {stream: true});
      let index: number;
      while ((index = buffer.indexOf('\n')) !== -1) {const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1); if (line) onLine(line);}
    }
    buffer += decoder.decode();
    if (buffer.trim()) onLine(buffer.trim());
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
