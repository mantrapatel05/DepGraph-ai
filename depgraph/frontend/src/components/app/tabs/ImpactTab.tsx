import { motion, useMotionValue, useTransform, animate } from 'framer-motion';
import { useEffect } from 'react';
import { useApp } from '@/context/AppContext';

const ImpactTab = () => {
  const { selectedNode, impactData, impactLoading, graphData } = useApp();
  
  // Find node details from graphData if available
  const nodeInfo = graphData?.nodes.find(n => n.id === selectedNode);
  const rawScore = impactData?.severity?.score ?? nodeInfo?.severity?.score ?? 0;
  // severity.score uses CRITICAL>=8 scale; multiply ×10 to map into 0–100 gauge range
  const score = Math.min(rawScore * 10, 100);

  const radius = 52;
  const circumference = 2 * Math.PI * radius;
  const arc = circumference * 0.75;
  const progress = (score / 100) * arc;

  const motionScore = useMotionValue(0);
  const displayScore = useTransform(motionScore, v => v.toFixed(2));

  useEffect(() => {
    const ctrl = animate(motionScore, score, { duration: 1.5, delay: 0.3, ease: [0.22, 1, 0.36, 1] });
    return () => ctrl.stop();
  }, [score, motionScore]);

  if (impactLoading) {
    return (
      <div className="p-4 flex flex-col items-center justify-center h-full gap-4">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
          className="w-10 h-10 border-2 border-teal-hex border-t-transparent rounded-full"
        />
        <span className="font-mono text-[12px]" style={{ color: 'var(--text-3-hex)' }}>Analyzing Impact...</span>
      </div>
    );
  }

  if (!selectedNode) {
    return (
      <div className="p-8 text-center">
        <div className="font-mono text-[12px]" style={{ color: 'var(--text-4-hex)' }}>Select a node to view impact analysis</div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5">
      {/* Gauge */}
      <div className="flex justify-center relative">
        <div className="absolute w-[100px] h-[100px] rounded-full" style={{
          background: `radial-gradient(circle, ${score > 50 ? 'rgba(255,87,51,0.2)' : 'rgba(0,229,184,0.1)'}, transparent)`,
          filter: 'blur(20px)',
          top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        }} />
        <svg width="140" height="140" viewBox="0 0 140 140">
          <circle cx="70" cy="70" r={radius} fill="none" stroke="var(--border-2-hex)" strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${arc} ${circumference - arc}`} transform="rotate(135 70 70)" />
          <defs>
            <linearGradient id="scoreGradient" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={score > 50 ? "#ff5733" : "var(--teal-hex)"} />
              <stop offset="100%" stopColor={score > 50 ? "#ff3d1a" : "var(--teal-2-hex)"} />
            </linearGradient>
          </defs>
          <motion.circle cx="70" cy="70" r={radius} fill="none" stroke="url(#scoreGradient)" strokeWidth="8" strokeLinecap="round"
            strokeDasharray={`${arc} ${circumference - arc}`}
            transform="rotate(135 70 70)"
            initial={{ strokeDashoffset: arc }}
            animate={{ strokeDashoffset: arc - progress }}
            transition={{ duration: 1.5, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
          />
          <motion.text x="70" y="62" textAnchor="middle" fontFamily="Fragment Mono" fontSize="26" fontWeight="500" fill={score > 50 ? "var(--orange-hex)" : "var(--teal-hex)"}>
            {displayScore}
          </motion.text>
          <text x="70" y="80" textAnchor="middle" fontFamily="Syne" fontSize="8" letterSpacing="0.15em" fill="var(--text-3-hex)">SEVERITY</text>
        </svg>
      </div>

      {/* Stat pills */}
      <div className="flex gap-2 justify-center flex-wrap">
        <span className="font-mono text-[11px] px-3 py-1 rounded-full" style={{
          background: 'var(--surface-hex)', border: '1px solid var(--border-2-hex)', color: '#f59e0b'
        }}>{impactData?.chain?.length || 0} Nodes</span>
        <span className="font-mono text-[11px] px-3 py-1 rounded-full" style={{
          background: 'var(--surface-hex)', border: '1px solid var(--border-2-hex)', color: 'var(--teal-hex)'
        }}>{nodeInfo?.language || 'Unknown'}</span>
        <span className="font-mono text-[11px] px-3 py-1 rounded-full" style={{
          background: 'var(--surface-hex)', border: '1px solid var(--border-2-hex)', color: '#a78bfa'
        }}>{impactData?.severity?.tier || nodeInfo?.severity?.tier || 'LOW'}</span>
      </div>

      {/* Section divider */}
      <div className="flex items-center gap-2">
        <span className="font-syne font-semibold text-[10px] tracking-[0.12em] whitespace-nowrap" style={{ color: 'var(--text-4-hex)' }}>AFFECTED PATHS</span>
        <div className="flex-1 h-px" style={{ background: 'var(--border-1-hex)' }} />
      </div>

      {/* Timeline/Paths */}
      <div className="space-y-0 overflow-y-auto max-h-48 pr-1 custom-scrollbar">
        {impactData?.chain?.length > 0 ? (
          impactData.chain.map((item: any, i: number) => {
            const isBreaking = item.max_break_risk === 'high' || item.max_break_risk === 'critical';
            const nodeName = item.node?.name || item.node?.id?.split('::').pop() || '?';
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
                className="flex gap-3"
              >
                <div className="flex flex-col items-center w-5">
                  {i > 0 && <div className="w-px flex-1" style={{ background: 'var(--border-2-hex)' }} />}
                  <div className="w-2 h-2 rounded-full shrink-0 my-1" style={{ background: isBreaking ? 'var(--orange-hex)' : 'var(--teal-hex)' }} />
                  {i < impactData.chain.length - 1 && <div className="w-px flex-1" style={{ background: 'var(--border-2-hex)' }} />}
                </div>
                <div className="py-2">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-mono text-[12px] truncate max-w-[140px]" style={{ color: 'var(--text-1-hex)' }}>{nodeName}</span>
                    {isBreaking && (
                      <span className="font-mono text-[9px] px-1.5 py-0.5 rounded-sm" style={{
                        background: 'rgba(255,87,51,0.1)', color: 'var(--orange-hex)', border: '1px solid rgba(255,87,51,0.35)'
                      }}>BREAKING</span>
                    )}
                  </div>
                  <div className="font-mono text-[11px]" style={{ color: 'var(--text-3-hex)' }}>
                    Conf: {(item.path_confidence * 100).toFixed(1)}% · {item.node?.language || '?'} · {item.node?.file?.split('/').pop() || ''}
                  </div>
                </div>
              </motion.div>
            );
          })
        ) : (
          <div className="font-mono text-[11px] text-center py-4" style={{ color: 'var(--text-4-hex)' }}>No significant downstream impact detected.</div>
        )}
      </div>

      {/* Confidence breakdown */}
      <div className="flex items-center gap-2">
        <span className="font-syne font-semibold text-[10px] tracking-[0.12em] whitespace-nowrap" style={{ color: 'var(--text-4-hex)' }}>CONFIDENCE</span>
        <div className="flex-1 h-px" style={{ background: 'var(--border-1-hex)' }} />
      </div>
      <div className="space-y-2">
        {[
          { label: 'AST Proof', pct: 100, color: 'var(--teal-hex)' },
          { label: 'Graph Path', pct: (nodeInfo?.confidence || 0.9) * 100, color: '#38bdf8' },
          { label: 'LLM Clarity', pct: impactData?.severity?.breakdown?.weighted_dependents ? Math.min(impactData.severity.breakdown.weighted_dependents * 10, 100) : 75, color: '#a78bfa' },
        ].map((bar, i) => (
          <div key={bar.label} className="flex items-center gap-2">
            <span className="font-mono text-[11px] w-[90px]" style={{ color: 'var(--text-3-hex)' }}>{bar.label}</span>
            <div className="w-[80px] h-1 rounded-full overflow-hidden" style={{ background: 'var(--border-1-hex)' }}>
              <motion.div
                className="h-full rounded-full"
                style={{ background: bar.color }}
                initial={{ width: 0 }}
                animate={{ width: `${bar.pct}%` }}
                transition={{ duration: 1, delay: i * 0.1 }}
              />
            </div>
            <span className="font-mono text-[11px]" style={{ color: 'var(--text-3-hex)' }}>{Math.round(bar.pct)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ImpactTab;
