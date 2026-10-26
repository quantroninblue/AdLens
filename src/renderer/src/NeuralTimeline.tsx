import type { NeuralSignal } from '../../shared/schema';
import { formatTime } from './frames';

// Within-clip z-scored response over time, pattern shifts as bars and TRIBE moments as markers.
export default function NeuralTimeline({neural}: {neural: NeuralSignal}) {
  const points = neural.global;
  if (points.length < 2) return <p className="subtle">Too few time steps to draw a timeline.</p>;
  const width = 760, height = 190, pad = {l: 34, r: 12, t: 14, b: 26};
  const t0 = points[0].t, t1 = points[points.length - 1].t || 1;
  const x = (t: number) => pad.l + (t - t0) / Math.max(1e-6, t1 - t0) * (width - pad.l - pad.r);
  const zMax = Math.max(2.5, ...points.map(p => Math.abs(p.activity)));
  const y = (z: number) => pad.t + (1 - (z + zMax) / (2 * zMax)) * (height - pad.t - pad.b);
  const changes = points.map(p => p.change ?? 0), cMax = Math.max(1e-6, ...changes);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.activity).toFixed(1)}`).join('');
  const ticks = Array.from({length: 6}, (_, i) => t0 + i * (t1 - t0) / 5);
  return <figure className="neural-timeline">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Predicted brain response over time">
      {[-2, 0, 2].map(z => <g key={z}><line x1={pad.l} x2={width - pad.r} y1={y(z)} y2={y(z)} className={z ? 'grid' : 'grid zero'}/><text x={pad.l - 6} y={y(z) + 3} textAnchor="end">{z > 0 ? `+${z}` : z}</text></g>)}
      {x(t0 + 3) > pad.l && <rect x={pad.l} y={pad.t} width={Math.max(0, x(Math.min(t1, t0 + 3)) - pad.l)} height={height - pad.t - pad.b} className="hook-window"/>}
      {points.map((p, i) => p.change !== null && <rect key={i} x={x(p.t) - 1.5} width={3} y={height - pad.b - (p.change / cMax) * 28} height={(p.change / cMax) * 28} className="change-bar"/>)}
      <path d={line} className="activity-line"/>
      {neural.moments.map((m, i) => <g key={i} className={`moment ${m.kind}`}><line x1={x(m.time)} x2={x(m.time)} y1={pad.t} y2={height - pad.b}/><circle cx={x(m.time)} cy={pad.t + 4} r={3.5}><title>{`${formatTime(m.time)} · ${m.kind}: ${m.detail}`}</title></circle></g>)}
      {ticks.map((t, i) => <text key={i} x={x(t)} y={height - 8} textAnchor="middle">{formatTime(t)}</text>)}
    </svg>
    <figcaption><span><i className="key-line"/>Overall response (z within clip)</span><span><i className="key-bar"/>Pattern shift</span><span><i className="key-hook"/>First 3 s</span><span><i className="key-peak"/>Peak</span><span><i className="key-dip"/>Dip</span><span><i className="key-shift"/>Shift</span></figcaption>
  </figure>;
}
