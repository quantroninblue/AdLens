import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, MessageSquareText, Settings2, Square, Trash2 } from 'lucide-react';
import type { ChatMessage, ChatRequest, ProviderStatus } from '../../shared/schema';
import { errorMessage } from './frames';

// Minimal, safe rendering: paragraphs, bullet lines and **bold**; no HTML from the model.
function Formatted({text}: {text: string}) {
  return <>{text.split(/\n{2,}/).map((block, i) => <p key={i}>{block.split('\n').map((line, j) => <span key={j} className={/^\s*([-*•]|\d+\.)\s/.test(line) ? 'chat-bullet' : undefined}>
    {line.split(/(\*\*[^*]+\*\*)/).map((part, k) => part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={k}>{part.slice(2, -2)}</strong> : part)}{j < block.split('\n').length - 1 && <br/>}</span>)}</p>)}</>;
}

export default function ChatPanel({reportId, reportTitle, draft, llm, onConnections}: {reportId: string | null; reportTitle?: string; draft: ChatRequest['draft']; llm?: ProviderStatus; onConnections: () => void}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState(''), [pending, setPending] = useState(''), [streaming, setStreaming] = useState(false), [error, setError] = useState('');
  const active = useRef(''), scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let current = true;
    setMessages([]); setError('');
    window.adlens.chatHistory(reportId).then(history => {if (current) setMessages(history);}).catch(e => setError(errorMessage(e)));
    return () => {current = false;};
  }, [reportId]);
  useEffect(() => window.adlens.onChat(event => {if (event.id === active.current && event.delta) setPending(p => p + event.delta);}), []);
  useEffect(() => {scroller.current?.scrollTo({top: scroller.current.scrollHeight});}, [messages, pending]);
  const send = async () => {
    const content = input.trim();
    if (!content || streaming) return;
    const next = [...messages, {role: 'user' as const, content}];
    const id = crypto.randomUUID(); active.current = id;
    setMessages(next); setInput(''); setPending(''); setStreaming(true); setError('');
    let reply = '';
    const stop = window.adlens.onChat(event => {if (event.id === id && event.delta) reply += event.delta;});
    try {
      await window.adlens.chat({id, reportId, messages: next.slice(-40), draft});
      if (reply.trim()) setMessages([...next, {role: 'assistant', content: reply}]);
    } catch (e) {setError(errorMessage(e));} finally {stop(); setPending(''); setStreaming(false); active.current = '';}
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {if (event.key === 'Enter' && !event.shiftKey) {event.preventDefault(); void send();}};
  const connected = llm?.state === 'available';
  return <aside className="chat-panel" aria-label="Chat">
    <div className="chat-head"><div><MessageSquareText size={15}/><div><strong>Chat</strong><small title={llm?.detail}>{connected ? llm.detail : 'No model connected'}</small></div></div>
      <button aria-label="Clear chat" disabled={streaming || !messages.length} onClick={async () => {try {await window.adlens.clearChat(reportId); setMessages([]);} catch (e) {setError(errorMessage(e));}}}><Trash2 size={14}/></button></div>
    <div className="chat-context">About: {reportTitle ? <strong>{reportTitle}</strong> : 'the current draft'}</div>
    <div className="chat-messages" ref={scroller}>
      {!messages.length && !streaming && <div className="chat-empty">{connected ? <><p>Ask about the report, a weak moment in the video, or have the model rewrite your hook or caption.</p>
        <div className="chat-suggestions">{(reportId ? ['Why did it get this virality score?', 'What should I change in the first 3 seconds?', 'Explain the TRIBE results in plain terms'] : ['Write three stronger hooks for this', 'What makes a Reel shareable on this platform?']).map(s => <button key={s} onClick={() => setInput(s)}>{s}</button>)}</div></>
        : <><p>Connect a local model, your ChatGPT or Claude account, or an API key to chat.</p><button className="secondary-button" onClick={onConnections}><Settings2 size={13}/> Open connections</button></>}</div>}
      {messages.map((m, i) => <div key={i} className={`chat-message ${m.role}`}>{m.role === 'assistant' ? <Formatted text={m.content}/> : <p>{m.content}</p>}</div>)}
      {streaming && <div className="chat-message assistant">{pending ? <Formatted text={pending}/> : <p className="chat-typing"><span/><span/><span/></p>}</div>}
      {error && <div className="chat-error" role="alert">{error}</div>}
    </div>
    <div className="chat-input"><textarea aria-label="Message" value={input} rows={2} maxLength={8000} placeholder={connected ? 'Message the model…  (Enter to send)' : 'Connect a model first'} disabled={!connected} onChange={e => setInput(e.target.value)} onKeyDown={keyDown}/>
      {streaming ? <button aria-label="Stop reply" onClick={() => window.adlens.cancelChat(active.current).catch(() => {})}><Square size={13}/></button>
        : <button aria-label="Send message" disabled={!connected || !input.trim()} onClick={() => void send()}><ArrowUp size={15}/></button>}</div>
  </aside>;
}
