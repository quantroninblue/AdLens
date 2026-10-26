import { useState, type FormEvent } from 'react';
import { ArrowRight, AudioLines, Brain, Check, CircleMinus, Clapperboard, FileImage, FileText, LoaderCircle, MessageSquareText, Music, Radio, Settings2, Target, X } from 'lucide-react';
import { platforms, type AnalysisInput, type Asset, type Progress, type ProviderStatus } from '../../shared/schema';
import { formatSize } from './frames';

export type WorkspaceItem = {asset: Asset; frames: 'none' | 'sampling' | 'ready' | 'failed'; note?: string};
export type Draft = {title: string; text: string; audience: string; platform: AnalysisInput['platform']};
const stages = [{key: 'prepare', label: 'Files & frames'}, {key: 'neural', label: 'TRIBE v2 brain response'}, {key: 'reasoning', label: 'Language model review'}, {key: 'report', label: 'Report'}] as const;
const kindIcon = (kind: Asset['kind'], size = 16) => kind === 'video' ? <Clapperboard size={size}/> : kind === 'audio' ? <Music size={size}/> : <FileImage size={size}/>;

export default function Workspace({items, draft, setDraft, busy, progress, statuses, onFiles, onBrowse, onRemove, onAnalyze, onCancel, onConnections}: {
  items: WorkspaceItem[]; draft: Draft; setDraft: (draft: Draft) => void; busy: boolean; progress: Progress[]; statuses: ProviderStatus[];
  onFiles: (files: File[]) => void; onBrowse: () => void; onRemove: (id: string) => void; onAnalyze: () => void; onCancel: () => void; onConnections: () => void;
}) {
  const [dragging, setDragging] = useState(false);
  const tribe = statuses.find(s => s.id === 'tribe'), llm = statuses.find(s => s.id === 'llm');
  const tribeInput = items.find(i => i.asset.kind === 'video') ?? items.find(i => i.asset.kind === 'audio');
  const sampling = items.some(i => i.frames === 'sampling');
  const submit = (event: FormEvent) => {event.preventDefault(); onAnalyze();};
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft({...draft, [key]: value});
  return <div className="page-content">
    <div className="page-heading"><div><div className="eyebrow">VIRALITY REVIEW <span>/ 01</span></div><h1>New analysis<span className="heading-dot">.</span></h1><p>Drop a Reel, short video, image or your copy. TRIBE predicts the brain response; your model reads it.</p></div>
      <div className="mode-pill"><span className={`status-dot ${llm?.state === 'available' ? 'online' : ''}`}/>{llm?.state === 'available' ? 'Model connected' : 'No model connected'}</div></div>
    <form onSubmit={submit}>
      <div className="input-grid"><section className="card creative-card"><div className="card-heading"><div><span className="section-number">01</span><h2>The content</h2></div><span className="subtle">Video, image, audio or copy</span></div>
        <div className={`upload-zone ${dragging ? 'dragging' : ''} ${items.length ? 'compact' : ''}`} onDragOver={e => {e.preventDefault(); if (!busy) setDragging(true);}} onDragLeave={() => setDragging(false)}
          onDrop={e => {e.preventDefault(); setDragging(false); if (!busy && e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);}}>
          {!items.length && <div className="upload-illustration" aria-hidden="true"><div className="mini-asset left"><FileText size={21}/><i/><i/></div><div className="mini-asset right"><Clapperboard size={26}/><i/></div><div className="mini-asset front"><FileImage size={29}/><span/></div></div>}
          <h3>{items.length ? 'Drop more files' : 'Drop your content here'}</h3>
          <p>or <button type="button" className="inline-link" disabled={busy} onClick={onBrowse}>browse files <ArrowRight size={12}/></button></p>
          <div className="file-formats">MP4, MOV, WEBM, MKV · JPG, PNG, WEBP · MP3, WAV · TXT, MD <span>·</span> TEXT FILES GO INTO THE COPY</div>
        </div>
        {items.length > 0 && <div className="asset-list">{items.map(item => <div className="asset-row" key={item.asset.id}>
          <div className="asset-media">{item.asset.kind === 'image' && item.asset.preview ? <img src={item.asset.preview} alt={`Preview of ${item.asset.name}`}/>
            : item.asset.kind === 'video' && item.asset.url ? <video src={item.asset.url} controls preload="metadata" aria-label={`Preview of ${item.asset.name}`}/>
            : item.asset.kind === 'audio' && item.asset.url ? <div className="audio-preview"><AudioLines size={22}/><audio src={item.asset.url} controls preload="metadata" aria-label={`Preview of ${item.asset.name}`}/></div>
            : <div className="video-placeholder">{kindIcon(item.asset.kind, 30)}</div>}</div>
          <div className="asset-meta"><strong>{item.asset.name}</strong><span>{item.asset.kind.toUpperCase()} · {formatSize(item.asset.size)}</span>
            <div className="asset-badges">{item === tribeInput && <span className="badge"><Brain size={11}/> TRIBE input</span>}
              {item.frames === 'sampling' && <span className="badge"><LoaderCircle size={11} className="spin"/> Sampling frames</span>}
              {item.frames === 'ready' && <span className="badge"><Check size={11}/> Frames ready</span>}
              {item.frames === 'failed' && <span className="badge warn" title={item.note}><CircleMinus size={11}/> No frames</span>}</div></div>
          <button type="button" className="icon-button" aria-label={`Remove ${item.asset.name}`} disabled={busy} onClick={() => onRemove(item.asset.id)}><X size={15}/></button>
        </div>)}</div>}
        <div className="copy-section"><div className="field-title"><label htmlFor="copy">Copy, caption & hook text</label><span>{draft.text.length.toLocaleString()} / 20,000</span></div><textarea id="copy" value={draft.text} maxLength={20000} disabled={busy} onChange={e => set('text', e.target.value)} placeholder="Paste the caption, on-screen text, script or ad copy…" rows={5}/><div className="copy-footer"><FileText size={13}/><span>Works on its own, or alongside the video.</span></div></div>
      </section>
      <div className="context-column"><section className="card context-card"><div className="card-heading"><div><span className="section-number">02</span><h2>The context</h2></div><Target size={16}/></div><div className="context-fields">
        <label htmlFor="title">Analysis name <span>Optional</span></label><input id="title" value={draft.title} onChange={e => set('title', e.target.value)} maxLength={160} disabled={busy} placeholder="e.g. Autumn launch · Reel 01"/>
        <label htmlFor="platform">Platform</label><select id="platform" value={draft.platform} onChange={e => set('platform', e.target.value as Draft['platform'])} disabled={busy}>{platforms.map(p => <option key={p}>{p}</option>)}</select>
        <label htmlFor="audience">Target audience <span>Optional</span></label><textarea id="audience" value={draft.audience} onChange={e => set('audience', e.target.value)} maxLength={1500} rows={3} disabled={busy} placeholder="Who is this for? Interests, age, what they scroll past."/></div></section>
        <section className="card pipeline-card"><div className="card-heading"><div><Radio size={15}/><h2>Analysis components</h2></div><button type="button" aria-label="Configure connections" onClick={onConnections}><Settings2 size={14}/></button></div>
          <div className="pipeline-rows">
            <div><span><Clapperboard size={14}/> Frames & files</span><span className="available">Local</span></div>
            <div title={tribe?.detail}><span><Brain size={14}/> TRIBE v2</span><span className={tribe?.state === 'available' ? 'available' : 'subtle'}>{tribe?.state === 'available' ? (tribeInput ? 'Ready' : 'Needs video/audio') : tribe?.state === 'unavailable' ? 'Unavailable' : 'Not found'}</span></div>
            <div title={llm?.detail}><span><MessageSquareText size={14}/> Language model</span><span className={llm?.state === 'available' ? 'available' : 'subtle'}>{llm?.state === 'available' ? 'Connected' : llm?.state === 'unavailable' ? 'Unavailable' : 'Not connected'}</span></div>
          </div><p>{tribe?.state === 'available' ? tribe.detail : 'TRIBE runs from a local Python environment. Set it up in Connections.'}</p></section>
      </div></div>
      <div className="analyze-bar"><div><span className="small-icon"><Radio size={16}/></span><p>{llm?.state === 'available' ? llm.detail : 'Without a model, only basic copy checks run.'}<span>{sampling ? 'Sampling video frames…' : tribeInput && tribe?.state === 'available' ? 'TRIBE can take several minutes per video, especially on CPU.' : 'Reports are saved in this workspace.'}</span></p></div>
        <button className="primary-button" type="submit" disabled={busy || sampling || (!draft.text.trim() && !items.length)}>{busy ? <LoaderCircle size={16} className="spin"/> : null}{busy ? 'Analyzing' : 'Analyze virality'}{!busy && <ArrowRight size={17}/>}</button></div>
    </form>
    {busy && <section className="card progress-card" aria-live="polite"><div className="card-heading"><h2>Analysis in progress</h2><button onClick={onCancel}>Cancel <X size={13}/></button></div><div className="progress-stages">{stages.map(stage => {const event = progress.find(p => p.stage === stage.key); return <div key={stage.key} className={`progress-stage ${event?.state ?? ''}`}><span>{event?.state === 'running' ? <LoaderCircle className="spin" size={17}/> : event?.state === 'done' ? <Check size={17}/> : event?.state === 'skipped' || event?.state === 'failed' ? <CircleMinus size={17}/> : <span className="waiting-circle"/>}</span><strong>{stage.label}</strong><small>{event?.detail ?? 'Waiting'}</small></div>;})}</div></section>}
  </div>;
}
