import Connections from './Connections';
import ReportView from './ReportView';
import Methodology from './Methodology';
import Workspace, { type Draft, type WorkspaceItem } from './Workspace';
import ChatPanel from './ChatPanel';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, ChevronRight, CircleHelp, Clapperboard, Clock3, FileImage, FileText, FolderOpen, LayoutGrid, Maximize2, Minus, MoreHorizontal, MoveUpRight, PanelRightClose, PanelRightOpen, Plus, Search, SlidersHorizontal, Trash2, X } from 'lucide-react';
import type { ImportedItem, Progress, ProviderStatus, Report, Settings } from '../../shared/schema';
import { errorMessage, sampleFrames } from './frames';

type Page = 'new' | 'history' | 'connections' | 'methodology' | 'report';
const formatDate = (value: string) => new Date(value).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
const emptyDraft: Draft = {title: '', text: '', audience: '', platform: 'Instagram'};
function Logo() {return <span className="logo-mark"><span/><span/><span/></span>;}

export default function App() {
  const [page, setPage] = useState<Page>('new');
  const [reports, setReports] = useState<Report[]>([]);
  const [selected, setSelected] = useState<Report>();
  const [statuses, setStatuses] = useState<ProviderStatus[]>([]);
  const [config, setConfig] = useState<Settings>();
  const [items, setItems] = useState<WorkspaceItem[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false), [chatOpen, setChatOpen] = useState(true);
  const [progress, setProgress] = useState<Progress[]>([]), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const activeId = useRef(''), runLock = useRef(false);
  const refresh = async () => {try {setStatuses(await window.adlens.status());} catch (e) {setError(errorMessage(e));}};
  useEffect(() => {
    Promise.all([window.adlens.history(), window.adlens.getSettings()]).then(([history, settings]) => {setReports(history); setConfig(settings);}).catch(e => setError(errorMessage(e)));
    void refresh();
    return window.adlens.onProgress(event => {if (event.id === activeId.current) setProgress(previous => [...previous.filter(p => p.stage !== event.stage), event]);});
  }, []);
  useEffect(() => {if (notice) {const timer = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timer);}}, [notice]);
  const navigate = (next: Page) => {setPage(next); setError('');};
  const openReport = (report: Report) => {setSelected(report); navigate('report');};
  const newAnalysis = () => {if (selected && !busy) {setDraft(emptyDraft); setItems([]); setSelected(undefined); setProgress([]);} navigate('new');};
  const accept = async (imported: ImportedItem[]) => {
    const text = imported.flatMap(i => i.type === 'text' ? [i.text.trim()] : []).filter(Boolean);
    if (text.length) setDraft(d => ({...d, text: [d.text.trim(), ...text].filter(Boolean).join('\n\n').slice(0, 20000)}));
    const added = imported.flatMap(i => i.type === 'asset' ? [{asset: i.asset, frames: i.asset.kind === 'video' ? 'sampling' as const : 'none' as const}] : []);
    setItems(list => [...list, ...added].slice(0, 8));
    for (const item of added) if (item.asset.kind === 'video' && item.asset.url) {
      const update = (patch: Partial<WorkspaceItem>) => setItems(list => list.map(i => i.asset.id === item.asset.id ? {...i, ...patch} : i));
      try {await window.adlens.setFrames(item.asset.id, await sampleFrames(item.asset.url)); update({frames: 'ready'});}
      catch (e) {update({frames: 'failed', note: errorMessage(e)});}
    }
  };
  const importFiles = async (files?: File[]) => {
    if (busy) return;
    setError('');
    try {await accept(files ? await window.adlens.importDropped(files) : await window.adlens.importAssets());} catch (e) {setError(errorMessage(e));}
  };
  const start = async () => {
    if (runLock.current) return;
    runLock.current = true; setBusy(true); setError(''); setProgress([]);
    const id = crypto.randomUUID(); activeId.current = id;
    try {
      const first = items[0]?.asset.name ?? draft.text.trim().split('\n')[0].slice(0, 70);
      const report = await window.adlens.analyze({id, title: draft.title.trim() || first || 'Untitled analysis', text: draft.text, audience: draft.audience, platform: draft.platform, assetIds: items.map(i => i.asset.id)});
      setReports(await window.adlens.history()); setSelected(report); setPage('report');
    } catch (e) {setError(errorMessage(e));} finally {setBusy(false); runLock.current = false; activeId.current = '';}
  };
  const exportReport = async () => {if (selected) try {if (await window.adlens.exportReport(selected.id)) setNotice('Report exported');} catch (e) {setError(errorMessage(e));}};
  const llm = statuses.find(s => s.id === 'llm'), tribe = statuses.find(s => s.id === 'tribe');
  const onReport = page === 'report' && selected;
  return <div className="app-shell">
    <header className="titlebar"><div className="brand"><Logo/><span>ad<span>lens</span></span><span className="version">STUDIO</span></div><div className="titlebar-center">Virality review workspace</div><div className="window-controls"><button aria-label={chatOpen ? 'Hide chat' : 'Show chat'} onClick={() => setChatOpen(o => !o)}>{chatOpen ? <PanelRightClose size={14}/> : <PanelRightOpen size={14}/>}</button><button aria-label="Minimize window" onClick={() => window.adlens.window('minimize')}><Minus size={14}/></button><button aria-label="Maximize window" onClick={() => window.adlens.window('maximize')}><Maximize2 size={12}/></button><button className="window-close" aria-label="Close window" onClick={() => window.adlens.window('close')}><X size={15}/></button></div></header>
    <div className="workspace">
      <aside className="sidebar">
        <button className="new-button" onClick={newAnalysis}><Plus size={16}/> New analysis <span>↗</span></button>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation"><button className={page === 'new' || page === 'report' ? 'active' : ''} onClick={() => navigate(selected ? 'report' : 'new')}><LayoutGrid size={16}/> Overview</button><button className={page === 'history' ? 'active' : ''} onClick={() => navigate('history')}><Clock3 size={16}/> Analyses <span className="nav-count">{reports.length.toString().padStart(2, '0')}</span></button><button className={page === 'connections' ? 'active' : ''} onClick={() => navigate('connections')}><SlidersHorizontal size={16}/> Connections</button></nav>
        <div className="recent-head"><span className="nav-label">RECENT</span><MoreHorizontal size={15}/></div>
        <div className="recent-list">{reports.slice(0, 5).map(report => <button key={report.id} onClick={() => openReport(report)} className={selected?.id === report.id && page === 'report' ? 'selected' : ''}>{report.assets.some(a => a.kind === 'video') ? <Clapperboard size={14}/> : report.assets.length ? <FileImage size={14}/> : <FileText size={14}/>}<span>{report.title}</span></button>)}{!reports.length && <p>Your analyses will appear here.</p>}</div>
        <div className="sidebar-bottom"><button className="connection-summary" onClick={() => navigate('connections')}><span className={`status-dot ${llm?.state === 'available' && tribe?.state === 'available' ? 'online' : ''}`}/><div><strong>{llm?.state === 'available' ? 'Model connected' : 'No model connected'}</strong><small>{tribe?.state === 'available' ? 'TRIBE v2 found' : 'TRIBE v2 not found'}</small></div><ChevronRight size={14}/></button><button className={`help-link ${page === 'methodology' ? 'active' : ''}`} onClick={() => navigate('methodology')}><CircleHelp size={15}/> How scoring works <MoveUpRight size={12}/></button><div className="sidebar-foot"><span>AdLens</span><span>0.2 / PROTOTYPE</span></div></div>
      </aside>
      <main>
        <div className="breadcrumb"><span>Workspace</span><ChevronRight size={12}/><span>{page === 'new' ? 'New analysis' : page === 'report' ? 'Virality report' : page === 'history' ? 'Analyses' : page === 'connections' ? 'Connections' : 'How scoring works'}</span><div className="breadcrumb-right"><span className="tiny-dot"/> Local workspace</div></div>
        <div className="page-scroll">
          {error && <div className="error-banner" role="alert"><CircleHelp size={16}/><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={15}/></button></div>}
          {page === 'new' && <Workspace items={items} draft={draft} setDraft={setDraft} busy={busy} progress={progress} statuses={statuses} onFiles={files => void importFiles(files)} onBrowse={() => void importFiles()}
            onRemove={id => setItems(list => list.filter(i => i.asset.id !== id))} onAnalyze={() => void start()} onCancel={() => window.adlens.cancel(activeId.current).catch(e => setError(errorMessage(e)))} onConnections={() => navigate('connections')}/>}
          {page === 'report' && selected && <ReportView report={selected} onExport={() => void exportReport()} onNew={newAnalysis}/>}
          {page === 'history' && <div className="page-content"><div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>Analyses<span className="heading-dot">.</span></h1><p>{reports.length} saved {reports.length === 1 ? 'report' : 'reports'}</p></div><button className="primary-button" onClick={newAnalysis}><Plus size={15}/> New analysis</button></div><div className="search-field"><Search size={16}/><input aria-label="Search analyses" placeholder="Search analyses" value={query} onChange={e => setQuery(e.target.value)}/></div><div className="history-list">{reports.filter(r => r.title.toLowerCase().includes(query.toLowerCase())).map(report => <div className="history-row" key={report.id}><button className="history-open" onClick={() => openReport(report)}><span className="history-icon">{report.assets.some(a => a.kind === 'video') ? <Clapperboard size={20}/> : report.assets.length ? <FileImage size={20}/> : <FileText size={20}/>}</span><div><strong>{report.title}</strong><span>{report.input.platform} <i>·</i> {report.basis === 'model' ? 'Model review' : 'Copy rules'}{report.neural ? <> <i>·</i> TRIBE</> : null} <i>·</i> {formatDate(report.createdAt)}</span></div><span className="history-score">{report.assessment.virality.score ?? '—'}<small>/ 100</small></span><ChevronRight size={17}/></button><button className="delete-report" aria-label={`Delete ${report.title}`} disabled={busy} onClick={async () => {if (confirm(`Delete “${report.title}”?`)) try {await window.adlens.removeReport(report.id); setReports(await window.adlens.history()); if (selected?.id === report.id) setSelected(undefined);} catch (e) {setError(errorMessage(e));}}}><Trash2 size={15}/></button></div>)}{!reports.length && <div className="empty-state"><FolderOpen size={36}/><h2>No analyses yet</h2><p>Your saved reports will live here.</p><button className="secondary-button" onClick={newAnalysis}>Create an analysis <ArrowRight size={15}/></button></div>}{reports.length > 0 && !reports.some(r => r.title.toLowerCase().includes(query.toLowerCase())) && <div className="empty-state"><Search size={28}/><h2>No matching analyses</h2><button className="secondary-button" onClick={() => setQuery('')}>Clear search</button></div>}</div></div>}
          {page === 'connections' && config && <Connections config={config} statuses={statuses} busy={busy} refresh={refresh} onError={setError} onSave={async value => {setError(''); try {setConfig(await window.adlens.saveSettings(value)); setNotice('Connections saved'); await refresh();} catch (e) {setError(errorMessage(e));}}}/>}
          {page === 'methodology' && <Methodology/>}
        </div>
        <footer className="statusbar"><span><span className={`status-dot ${busy ? 'working' : ''}`}/>{busy ? 'Analysis running' : 'Workspace ready'}</span><span>{busy && page !== 'new' && <button onClick={() => setPage('new')}>View progress <ArrowRight size={11}/></button>}<span>ESTIMATES, NOT OUTCOMES</span><span className="statusbar-divider"/>Local storage</span></footer>
      </main>
      {chatOpen && <ChatPanel reportId={onReport ? selected.id : null} reportTitle={onReport ? selected.title : undefined} llm={llm} onConnections={() => navigate('connections')}
        draft={onReport ? undefined : {title: draft.title, text: draft.text, audience: draft.audience, platform: draft.platform, assets: items.map(i => i.asset.name)}}/>}
    </div>
    {notice && <div className="toast" role="status"><Check size={16}/>{notice}</div>}
  </div>;
}
