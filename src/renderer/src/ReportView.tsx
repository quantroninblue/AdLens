import { useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Brain, Check, CircleMinus, CirclePlus, Clock3, FileImage, Flame, MoveUpRight, Target, TrendingDown, TrendingUp } from 'lucide-react';
import { llmProviderLabels, type Report } from '../../shared/schema';
import { metricKeys, metricLabels } from '../../shared/metrics';
import NeuralTimeline from './NeuralTimeline';
import { formatSize, formatTime } from './frames';

const formatDate = (value: string) => new Date(value).toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'});
const bandLabel = {low: 'Low', moderate: 'Moderate', high: 'High', breakout: 'Breakout'} as const;
const z = (value: number | null) => value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(1)}`;
const Time = ({t}: {t?: number | null}) => t === undefined || t === null ? null : <span className="time-chip"><Clock3 size={10}/>{formatTime(t)}</span>;

export default function ReportView({report, onExport, onNew}: {report: Report; onExport: () => void; onNew: () => void}) {
  const [tab, setTab] = useState<'assessment' | 'neural' | 'evidence'>('assessment');
  const {assessment, neural} = report, virality = assessment.virality;
  const assessed = metricKeys.filter(k => assessment.metrics[k].score !== null).length;
  return <div className="page-content report-page">
    <div className="report-topline"><button className="text-button" onClick={onNew}><ArrowLeft size={14}/> New analysis</button><span>{formatDate(report.createdAt)} <i>·</i> {report.input.platform}</span></div>
    <div className="page-heading"><div><div className="eyebrow">VIRALITY REPORT <span>/ {report.id.slice(0, 6).toUpperCase()}</span></div><h1>{report.title}</h1>
      <div className="report-tags"><span>{report.basis === 'model' ? report.metadata.llm ? llmProviderLabels[report.metadata.llm.provider] : 'Model assessment' : 'Copy rules only'}</span><span>{neural ? 'TRIBE v2 brain response' : 'No TRIBE signal'}</span>{report.assets.map(a => <span key={a.name}>{a.name}</span>)}</div></div>
      <button className="secondary-button" onClick={onExport}><ArrowDownToLine size={15}/> Export report</button></div>
    <div className="score-grid">
      <section className="card overall-card virality-card"><div className="eyebrow">VIRALITY POTENTIAL <Flame size={13}/></div>
        <div className="overall-number">{virality.score ?? '—'}<span>/ 100</span><div className="score-orbit" aria-hidden="true"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42"/><circle cx="50" cy="50" r="42" className="orbit-value" strokeDasharray={`${(virality.score ?? 0) * 2.639} 264`}/></svg><Target size={24}/></div></div>
        <p>{virality.band ? `${bandLabel[virality.band]} potential` : 'Not estimated'} · {virality.confidence} confidence</p><div className="score-track"><span style={{width: `${virality.score ?? 0}%`}}/></div></section>
      <section className="card engagement-card"><div className="eyebrow">CONTENT SCORE</div><div className="engagement-number">{report.overall ?? '—'}<span>/ 100</span></div><p>{assessed} of {metricKeys.length} dimensions assessed</p><small>Weighted mean of the dimension scores below. An estimate, not a forecast of views.</small></section>
      <section className="card summary-card"><div className="eyebrow">WHY THIS SCORE</div><p>{virality.rationale}</p><div className="summary-foot"><span className="status-dot"/>{assessment.summary.slice(0, 220)}{assessment.summary.length > 220 ? '…' : ''}</div></section>
    </div>
    <div className="report-tabs" role="tablist"><button role="tab" aria-selected={tab === 'assessment'} className={tab === 'assessment' ? 'active' : ''} onClick={() => setTab('assessment')}>Assessment</button><button role="tab" aria-selected={tab === 'neural'} className={tab === 'neural' ? 'active' : ''} onClick={() => setTab('neural')}>Brain response</button><button role="tab" aria-selected={tab === 'evidence'} className={tab === 'evidence' ? 'active' : ''} onClick={() => setTab('evidence')}>Evidence & sources</button><span>{report.basis === 'heuristic' ? 'Copy rules v1' : 'Structured model output'}</span></div>
    {tab === 'assessment' && <>
      <section className="card prose-card report-summary"><h2>Summary</h2><p>{assessment.summary}</p></section>
      <section className="metric-grid">{metricKeys.map(key => {const metric = assessment.metrics[key]; return <div className="card metric-card" key={key}><div><h3>{metricLabels[key]}</h3><strong>{metric.score ?? '—'}{metric.score !== null && <small>/100</small>}</strong></div><div className="metric-track"><span style={{width: `${metric.score ?? 0}%`}}/></div><p>{metric.evidence}</p></div>;})}</section>
      <div className="findings-grid"><section className="card findings-card"><h2><CirclePlus size={17}/> Strengths <span>{assessment.strengths.length.toString().padStart(2, '0')}</span></h2>{assessment.strengths.length ? <ul>{assessment.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul> : <p className="subtle">Not enough evidence to identify strengths.</p>}</section><section className="card findings-card"><h2><CircleMinus size={17}/> Areas to improve <span>{assessment.weaknesses.length.toString().padStart(2, '0')}</span></h2>{assessment.weaknesses.length ? <ul>{assessment.weaknesses.map((s, i) => <li key={i}>{s}</li>)}</ul> : <p className="subtle">No weaknesses established by the available evidence.</p>}</section></div>
      <section className="card recommendations"><div className="card-heading"><div><MoveUpRight size={17}/><h2>Recommended edits</h2></div><span className="subtle">Next iteration</span></div>{assessment.recommendations.map((r, i) => <div className="recommendation" key={i}><span>{(i + 1).toString().padStart(2, '0')}</span><div><h3>{r.title} <Time t={r.time}/></h3><p>{r.detail}</p></div><ArrowRight size={15}/></div>)}</section>
    </>}
    {tab === 'neural' && (neural ? <>
      <section className="card neural-panel"><div className="card-heading"><div><Brain size={16}/><h2>Predicted brain response · {neural.asset}</h2></div><span className="subtle">{neural.timesteps} steps · {neural.tr}s TR · {neural.device}</span></div><NeuralTimeline neural={neural}/></section>
      {assessment.neuralReading && <section className="card prose-card"><h2>What the model read from it</h2><p>{assessment.neuralReading.summary}</p>{assessment.neuralReading.moments.map((m, i) => <div className="observation" key={i}><span>{formatTime(m.time)}</span><p><strong>{m.observation}</strong> {m.implication}</p></div>)}</section>}
      {neural.regions.length > 0 && <section className="card region-table"><div className="card-heading"><div><h2>Brain systems</h2></div><span className="subtle">{neural.atlas}</span></div>
        <table><thead><tr><th>System</th><th>Opening (first 3 s)</th><th>Peak</th><th>Trend / 10 s</th></tr></thead><tbody>{neural.regions.map(r => <tr key={r.id}><td>{r.label}</td><td className={r.hookZ !== null && r.hookZ > 0.3 ? 'up' : r.hookZ !== null && r.hookZ < -0.3 ? 'down' : ''}>{z(r.hookZ)}</td><td>{z(r.peakZ)} at {formatTime(r.peakTime)}</td><td className={r.trend > 0.2 ? 'up' : r.trend < -0.2 ? 'down' : ''}>{r.trend > 0.2 ? <TrendingUp size={13}/> : r.trend < -0.2 ? <TrendingDown size={13}/> : null} {z(r.trend)}</td></tr>)}</tbody></table></section>}
      <section className="card prose-card"><h2>Moments TRIBE flagged</h2>{neural.moments.length ? neural.moments.map((m, i) => <div className="observation" key={i}><span>{formatTime(m.time)}</span><p><strong className={`moment-kind ${m.kind}`}>{m.kind}</strong> {m.detail}</p></div>) : <p className="subtle">No notable peaks, dips or shifts.</p>}
        <h3>How to read this</h3><p>{neural.method}</p><p>{neural.timeConvention}</p><p className="subtle">TRIBE predicts an average viewer’s cortical response; it does not measure a real audience, and there is no validated link between these values and virality.</p></section>
    </> : <section className="card prose-card"><h2>No TRIBE signal in this report</h2><p>{report.metadata.providers.find(p => p.name === 'TRIBE v2')?.detail ?? 'TRIBE was not used.'}</p><p className="subtle">TRIBE runs on video or audio files when a Python environment with tribev2 is connected in Connections.</p></section>)}
    {tab === 'evidence' && <div className="evidence-grid">
      <section className="card evidence-card"><h2>Components used</h2>{report.metadata.providers.map((p, i) => <div className="provider-evidence" key={i}>{p.state === 'used' ? <Check size={16}/> : <CircleMinus size={16}/>}<div><strong>{p.name}</strong><p>{p.detail}</p></div><span>{p.state}</span></div>)}
        <h3>Models</h3><p>{report.metadata.models.join(', ') || 'No model inference was used.'}</p>
        <h3>Content score weights</h3>{Object.entries(report.metadata.contributions).map(([key, weight]) => <div className="weight-row" key={key}><span>{metricLabels[key as keyof typeof metricLabels] ?? key}</span><strong>{(weight * 100).toFixed(1)}%</strong></div>)}<p>Missing dimensions are excluded and the remaining weights renormalized. These are project heuristics.</p>
        <h3>Limitations</h3><ul className="limitations">{report.metadata.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul></section>
      <section className="card evidence-card"><h2>Source material</h2>{report.assets.map(a => <p key={a.name}><FileImage size={14}/> {a.name} · {a.kind} · {formatSize(a.size)}</p>)}
        {report.media.assets.some(a => a.frameTimes.length) && <><h3>Frames shown to the model</h3><p>{report.media.imagesSent ? report.media.assets.filter(a => a.frameTimes.length).map(a => `${a.name}: ${a.frameTimes.map(formatTime).join(', ')}`).join(' · ') : 'Frames were sampled but the model could not view images.'}</p></>}
        <h3>Supplied copy</h3><p className="source-copy">{report.input.text || 'No copy supplied.'}</p><h3>Audience brief</h3><p>{report.input.audience || 'Not supplied.'}</p>
        {report.media.transcript && <><h3>Transcript <small>{report.media.transcriptSource}</small></h3><p className="source-copy">{report.media.transcript}</p></>}</section>
    </div>}
  </div>;
}
