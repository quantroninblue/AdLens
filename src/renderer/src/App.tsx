import Connections from './Connections';
import ReportView from './ReportView';
import Methodology from './Methodology';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, AudioLines, Check, ChevronRight, CircleHelp, CircleMinus, Clapperboard, Clock3, FileImage, FileText, FolderOpen, LayoutGrid, LoaderCircle, Maximize2, Minus, MoreHorizontal, MoveUpRight, Plus, Radio, Search, Settings2, SlidersHorizontal, Target, Trash2, X } from 'lucide-react';
import { type AnalysisInput, type Asset, type Progress, type ProviderStatus, type Report, type Settings } from '../../shared/schema';

type Page = 'new' | 'history' | 'connections' | 'methodology' | 'report';
const stages = [{key: 'prepare', label: 'Content & context'}, {key: 'media', label: 'Visuals & audio'}, {key: 'neural', label: 'Neural response'}, {key: 'reasoning', label: 'Content assessment'}, {key: 'report', label: 'Report'}] as const;
const formatDate = (value: string) => new Date(value).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': Error: /, '');
function Logo() {return <span className="logo-mark"><span/><span/><span/></span>;}

export default function App() {
  const [page, setPage] = useState<Page>('new');
  const [reports, setReports] = useState<Report[]>([]);
  const [selected, setSelected] = useState<Report>();
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [config, setConfig] = useState<Settings>();
  const [asset, setAsset] = useState<Asset>();
  const [title, setTitle] = useState(''), [text, setText] = useState(''), [audience, setAudience] = useState('');
  const [platform, setPlatform] = useState<AnalysisInput['platform']>('Instagram');
  const [busy, setBusy] = useState(false), [checking, setChecking] = useState(false), [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<Progress[]>([]), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const activeId = useRef('');
  const runLock = useRef(false);
  const refresh = async () => {setChecking(true); try {setStatuses(await window.adlens.models());} catch (e) {setError(errorMessage(e));} finally {setChecking(false);}};
  useEffect(() => {
    Promise.all([window.adlens.history(), window.adlens.getSettings()]).then(([history, settings]) => {setReports(history); setConfig(settings);}).catch(e => setError(errorMessage(e)));
    void refresh();
    return window.adlens.onProgress(event => {if (event.id === activeId.current) setProgress(previous => [...previous.filter(p => p.stage !== event.stage), event]);});
  }, []);
  useEffect(() => {if (notice) {const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer);}}, [notice]);
  const navigate = (next: Page) => {setPage(next); setError('');};
  const openReport = (report: Report) => {setSelected(report); navigate('report');};
  const newAnalysis = () => {if (selected && !busy) {setTitle(''); setText(''); setAudience(''); setAsset(undefined); setSelected(undefined); setProgress([]);} navigate('new');};
  const importAsset = async (file?: File) => {
    if (busy) return;
    setError('');
    try {const result = file ? await window.adlens.importDropped(file) : await window.adlens.importAsset(); if (result) setAsset(result);} catch (e) {setError(errorMessage(e));}
  };
  const start = async (event: FormEvent) => {
    event.preventDefault(); if (runLock.current) return;
    runLock.current = true; setBusy(true); setError(''); setProgress([]);
    const id = crypto.randomUUID(); activeId.current = id;
    try {
      const report = await window.adlens.analyze({id, title: title.trim() || asset?.name || text.trim().split('\n')[0].slice(0, 70), text, audience, platform, assetId: asset?.id});
      setReports(await window.adlens.history()); setSelected(report); setPage('report');
    } catch (e) {setError(errorMessage(e));} finally {setBusy(false); runLock.current = false; activeId.current = '';}
  };
  const exportReport = async () => {if (selected) try {if (await window.adlens.exportReport(selected.id)) setNotice('Report exported');} catch (e) {setError(errorMessage(e));}};
  const connected = statuses.filter(s => s.state === 'available').length;
  const isRemote = !!config?.reasoningUrl;
  return <div className="app-shell">
    <header className="titlebar"><div className="brand"><Logo/><span>ad<span>lens</span></span><span className="version">STUDIO</span></div><div className="titlebar-center">Content intelligence workspace</div><div className="window-controls"><button aria-label="Minimize window" onClick={() => window.adlens.window('minimize')}><Minus size={14}/></button><button aria-label="Maximize window" onClick={() => window.adlens.window('maximize')}><Maximize2 size={12}/></button><button className="window-close" aria-label="Close window" onClick={() => window.adlens.window('close')}><X size={15}/></button></div></header>
    <div className="workspace">
      <aside className="sidebar">
        <button className="new-button" onClick={newAnalysis}><Plus size={16}/> New analysis <span>↗</span></button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation"><button className={page === 'new' || page === 'report' ? 'active' : ''} onClick={() => navigate(selected ? 'report' : 'new')}><LayoutGrid size={16}/> Overview</button><button className={page === 'history' ? 'active' : ''} onClick={() => navigate('history')}><Clock3 size={16}/> Analyses <span className="nav-count">{reports.length.toString().padStart(2, '0')}</span></button><button className={page === 'connections' ? 'active' : ''} onClick={() => navigate('connections')}><SlidersHorizontal size={16}/> Connections</button></nav>
        <div className="recent-head"><span className="nav-label">RECENT</span><MoreHorizontal size={15}/></div>
        <div className="recent-list">{reports.slice(0, 5).map(report => <button key={report.id} onClick={() => openReport(report)} className={selected?.id === report.id && page === 'report' ? 'selected' : ''}>{report.asset ? <FileImage size={14}/> : <FileText size={14}/>}<span>{report.title}</span></button>)}{!reports.length && <p>Your analyses will appear here.</p>}</div>
        <div className="sidebar-bottom"><button className="connection-summary" onClick={() => navigate('connections')}><span className={`status-dot ${connected ? 'online' : ''}`}/><div><strong>{connected ? `${connected} provider${connected > 1 ? 's' : ''} connected` : 'Local workspace'}</strong><small>{connected ? 'Remote inference' : 'Cloud connections pending'}</small></div><ChevronRight size={14}/></button><button className={`help-link ${page === 'methodology' ? 'active' : ''}`} onClick={() => navigate('methodology')}><CircleHelp size={15}/> Scoring notes <MoveUpRight size={12}/></button><div className="sidebar-foot"><span>AdLens</span><span>0.1 / PROTOTYPE</span></div></div>
      </aside>
      <main>
        <div className="breadcrumb"><span>Workspace</span><ChevronRight size={12}/><span>{page === 'new' ? 'New analysis' : page === 'report' ? 'Analysis report' : page === 'history' ? 'Analyses' : page === 'connections' ? 'Connections' : 'Scoring notes'}</span><div className="breadcrumb-right"><span className="tiny-dot"/> Private workspace</div></div>
        <div className="page-scroll">
          {error && <div className="error-banner" role="alert"><CircleHelp size={16}/><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={15}/></button></div>}
          {page === 'new' && <div className="page-content">
            <div className="page-heading"><div><div className="eyebrow">CONTENT ANALYSIS <span>/ 01</span></div><h1>New analysis<span className="heading-dot">.</span></h1><p>Upload an image or video, or enter your copy below.</p></div><div className="mode-pill"><span className={`status-dot ${isRemote ? 'online' : ''}`}/>{isRemote ? 'Remote inference configured' : 'Copy assessment mode'}</div></div>
            <form onSubmit={start}>
              <div className="input-grid"><section className="card creative-card"><div className="card-heading"><div><span className="section-number">01</span><h2>The creative</h2></div><span className="subtle">Image, video, or copy</span></div>
                <div className={`upload-zone ${dragging ? 'dragging' : ''} ${asset ? 'has-asset' : ''}`} onDragOver={event => {event.preventDefault(); if (!busy) setDragging(true);}} onDragLeave={() => setDragging(false)} onDrop={event => {event.preventDefault(); setDragging(false); if (event.dataTransfer.files[0]) void importAsset(event.dataTransfer.files[0]);}}>
                  {asset ? <><div className="asset-display">{asset.preview ? <img src={asset.preview} alt={`Preview of ${asset.name}`}/> : <div className="video-placeholder"><Clapperboard size={38}/><span>VIDEO</span></div>}</div><div className="asset-details"><div><strong>{asset.name}</strong><span>{(asset.size / 1024 / 1024).toFixed(1)} MB · {asset.mime.split('/')[1].toUpperCase()}</span></div><button type="button" aria-label="Remove asset" disabled={busy} onClick={() => setAsset(undefined)}><X size={16}/></button></div></> : <><div className="upload-illustration" aria-hidden="true"><div className="mini-asset left"><FileText size={21}/><i/><i/></div><div className="mini-asset right"><Clapperboard size={26}/><i/></div><div className="mini-asset front"><FileImage size={29}/><span/></div></div><h3>Drop your content here</h3><p>or <button type="button" className="inline-link" disabled={busy} onClick={() => void importAsset()}>browse files <ArrowRight size={12}/></button></p><div className="file-formats">JPG, PNG, WEBP, MP4, MOV, WEBM <span>·</span> UP TO 100 MB</div></>}
                </div>
                <div className="copy-section"><div className="field-title"><label htmlFor="copy">Copy & caption</label><span>{text.length.toLocaleString()} / 20,000</span></div><textarea id="copy" value={text} maxLength={20000} disabled={busy} onChange={e => setText(e.target.value)} placeholder="Paste a headline, caption, or the copy that accompanies your creative…" rows={5}/><div className="copy-footer"><FileText size={13}/><span>Works on its own, or alongside an asset.</span></div></div>
              </section>
              <div className="context-column"><section className="card context-card"><div className="card-heading"><div><span className="section-number">02</span><h2>The context</h2></div><Target size={16}/></div><div className="context-fields"><label htmlFor="title">Analysis name <span>Optional</span></label><input id="title" value={title} onChange={e => setTitle(e.target.value)} maxLength={160} disabled={busy} placeholder="e.g. Autumn launch · Reel 01"/><label htmlFor="platform">Channel</label><select id="platform" value={platform} onChange={e => setPlatform(e.target.value as AnalysisInput['platform'])} disabled={busy}>{['Instagram', 'TikTok', 'YouTube', 'LinkedIn', 'General'].map(p => <option key={p}>{p}</option>)}</select><label htmlFor="audience">Target audience <span>Optional</span></label><textarea id="audience" value={audience} onChange={e => setAudience(e.target.value)} maxLength={1500} rows={3} disabled={busy} placeholder="Who is this for? Include their interests, needs, or buying context."/></div></section>
                <section className="card pipeline-card"><div className="card-heading"><div><Radio size={15}/><h2>Analysis components</h2></div><button type="button" aria-label="Configure providers" onClick={() => navigate('connections')}><Settings2 size={14}/></button></div><div className="pipeline-rows"><div><span><FileText size={14}/> Copy checks</span><span className="available">Available</span></div>{[{id: 'media', label: 'Visuals & audio'}, {id: 'reasoning', label: 'Reasoning model'}, {id: 'tribe', label: 'TRIBE v2'}].map(p => <div key={p.id}><span>{p.id === 'media' ? <Clapperboard size={14}/> : p.id === 'tribe' ? <AudioLines size={14}/> : <LayoutGrid size={14}/>} {p.label}</span><span className={statuses.find(s => s.id === p.id)?.state === 'available' ? 'available' : 'subtle'}>{statuses.find(s => s.id === p.id)?.state === 'available' ? 'Connected' : statuses.find(s => s.id === p.id)?.state === 'unavailable' ? 'Unavailable' : 'Not connected'}</span></div>)}</div><p>Only components used in this analysis will appear in your report.</p></section>
              </div></div>
              <div className="analyze-bar"><div><span className="small-icon"><Radio size={16}/></span><p>{isRemote || config?.mediaUrl || config?.tribeUrl ? 'Content is sent to your configured providers.' : 'Your content stays on this device.'}<span>{asset && !config?.mediaUrl ? 'Connect media analysis to assess this asset. Copy can be assessed now.' : 'Reports are saved in this workspace.'}</span></p></div><button className="primary-button" type="submit" disabled={busy || (!text.trim() && !asset)}>{busy ? <LoaderCircle size={16} className="spin"/> : null}{busy ? 'Analyzing' : 'Analyze content'}{!busy && <ArrowRight size={17}/>}</button></div>
            </form>
            {busy && <section className="card progress-card" aria-live="polite"><div className="card-heading"><h2>Analysis in progress</h2><button onClick={() => window.adlens.cancel(activeId.current).catch(e => setError(errorMessage(e)))}>Cancel <X size={13}/></button></div><div className="progress-stages">{stages.map(stage => {const event = progress.find(p => p.stage === stage.key); return <div key={stage.key} className={`progress-stage ${event?.state ?? ''}`}><span>{event?.state === 'running' ? <LoaderCircle className="spin" size={17}/> : event?.state === 'done' ? <Check size={17}/> : event?.state === 'skipped' || event?.state === 'failed' ? <CircleMinus size={17}/> : <span className="waiting-circle"/>}</span><strong>{stage.label}</strong><small>{event?.detail ?? 'Waiting'}</small></div>;})}</div></section>}
            <div className="workspace-note"><span>WORKSPACE / 01</span><p>Image · Video · Copy</p><div className="note-line"/></div>
          </div>}
          {page === 'report' && selected && <ReportView report={selected} onExport={() => void exportReport()} onNew={newAnalysis} />}
          {page === 'history' && <div className="page-content"><div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>Analyses<span className="heading-dot">.</span></h1><p>{reports.length} saved {reports.length === 1 ? 'report' : 'reports'}</p></div><button className="primary-button" onClick={newAnalysis}><Plus size={15}/> New analysis</button></div><div className="search-field"><Search size={16}/><input aria-label="Search analyses" placeholder="Search analyses" value={query} onChange={e => setQuery(e.target.value)}/></div><div className="history-list">{reports.filter(r => r.title.toLowerCase().includes(query.toLowerCase())).map(report => <div className="history-row" key={report.id}><button className="history-open" onClick={() => openReport(report)}><span className="history-icon">{report.asset?.mime.startsWith('video') ? <Clapperboard size={20}/> : report.asset ? <FileImage size={20}/> : <FileText size={20}/>}</span><div><strong>{report.title}</strong><span>{report.input.platform} <i>·</i> {report.basis === 'model' ? 'Model assessment' : 'Copy rules'} <i>·</i> {formatDate(report.createdAt)}</span></div><span className="history-score">{report.overall ?? '—'}<small>/ 100</small></span><ChevronRight size={17}/></button><button className="delete-report" aria-label={`Delete ${report.title}`} disabled={busy} onClick={async () => {if (confirm(`Delete “${report.title}”?`)) try {await window.adlens.removeReport(report.id); setReports(await window.adlens.history()); if (selected?.id === report.id) setSelected(undefined);} catch (e) {setError(errorMessage(e));}}}><Trash2 size={15}/></button></div>)}{!reports.length && <div className="empty-state"><FolderOpen size={36}/><h2>No analyses yet</h2><p>Your saved reports will live here.</p><button className="secondary-button" onClick={newAnalysis}>Create an analysis <ArrowRight size={15}/></button></div>}{reports.length > 0 && !reports.some(r => r.title.toLowerCase().includes(query.toLowerCase())) && <div className="empty-state"><Search size={28}/><h2>No matching analyses</h2><button className="secondary-button" onClick={() => setQuery('')}>Clear search</button></div>}</div></div>}
          {page === 'connections' && config && <Connections config={config} statuses={statuses} checking={checking} busy={busy} refresh={refresh} onSave={async value => {setError(''); try {setConfig(await window.adlens.saveSettings(value)); setNotice('Connections saved'); await refresh();} catch (e) {setError(errorMessage(e));}}}/>}
          {page === 'methodology' && <Methodology/>}
        </div>
        <footer className="statusbar"><span><span className={`status-dot ${busy ? 'working' : ''}`}/>{busy ? 'Analysis running' : 'Workspace ready'}</span><span>{busy && page !== 'new' && <button onClick={() => setPage('new')}>View progress <ArrowRight size={11}/></button>}<span>ESTIMATES, NOT OUTCOMES</span><span className="statusbar-divider"/>Local storage</span></footer>
      </main>
    </div>
    {notice && <div className="toast" role="status"><Check size={16}/>{notice}</div>}
  </div>;
}
