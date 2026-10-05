export function endpoint(base: string, suffix: string) {
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash) throw new Error('Use a base URL without credentials, query parameters, or fragments.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('Remote endpoints require HTTPS. HTTP is allowed only for localhost.');
  return `${url.toString().replace(/\/$/, '')}/${suffix}`;
}
export async function request(url: string, key: string | undefined, init: RequestInit, signal: AbortSignal, timeout = 180000) {
  const response = await fetch(url, {...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]), headers: {...(key ? {Authorization: `Bearer ${key}`} : {}), ...init.headers}});
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}. Check its connection and authentication.`);
  return response;
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
// Consume actual SSE deltas, handling boundaries split across arbitrary network chunks.
export async function readCompletion(response: Response, onDelta: (count: number) => void): Promise<string> {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const payload = JSON.parse(await boundedText(response));
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Provider returned no structured content.');
    return content;
  }
  if (!response.body) throw new Error('Provider returned an empty stream.');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', content = '', bytes = 0;
  const consume = (event: string) => {
    const data = event.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') return;
    const message = JSON.parse(data);
    if (message.error) throw new Error('Provider reported an error while streaming.');
    const delta = message.choices?.[0]?.delta?.content;
    if (typeof delta === 'string') { content += delta; onDelta(content.length); }
  };
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1000000) throw new Error('Provider stream exceeds the size limit.');
      buffer += decoder.decode(value, {stream: true});
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        consume(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) consume(buffer);
    if (!content) throw new Error('Provider returned no structured content.');
    return content;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
