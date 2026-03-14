import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import { useApp } from '@/context/AppContext';

type AnalysisState = 'idle' | 'running' | 'complete';

const TopBar = () => {
  const { analysisComplete, analysisRunning, startAnalysisStream, repoUrl, graphData } = useApp();
  const [btnState, setBtnState] = useState<AnalysisState>('idle');

  useEffect(() => {
    if (analysisRunning) setBtnState('running');
    else if (analysisComplete) setBtnState('complete');
    else setBtnState('idle');
  }, [analysisRunning, analysisComplete]);

  const handleRun = () => {
    if (analysisRunning) return;
    startAnalysisStream(repoUrl || '.');
  };

  const breakingCount = graphData?.edges.filter((e: any) => {
    const risk = e.data?.break_risk;
    return risk === 'high' || risk === 'critical' || risk === 'HIGH' || risk === 'CRITICAL';
  }).length || 0;
  const languageCount = new Set(graphData?.nodes.map((n: any) => n.language)).size;

  return (
    <div
      className="h-12 flex items-center justify-between px-4 border-b shrink-0"
      style={{ background: 'var(--void-hex)', borderColor: 'var(--border-1-hex)' }}
    >
      {/* Left */}
      <div className="flex items-center gap-3">
        <span style={{ color: 'var(--teal-hex)' }}>⚡</span>
        <span className="font-syne font-bold text-sm" style={{ color: 'var(--text-1-hex)' }}>DepGraph.ai</span>
        <span className="font-mono text-[11px] px-2 py-0.5 rounded" style={{ color: 'var(--text-4-hex)', background: 'var(--surface-hex)' }}>v2.4.1-beta</span>
        <span className="font-mono text-[11px]" style={{ color: 'var(--text-3-hex)' }}>feature/auth-refactor ⎇</span>
      </div>

      {/* Center */}
      <div className="absolute left-1/2 -translate-x-1/2">
        {analysisComplete ? (
          <span className="font-mono text-[12px]" style={{ color: 'var(--text-3-hex)' }}>
            <span style={{ color: breakingCount > 0 ? 'var(--orange-hex)' : 'var(--teal-hex)' }}>
              {breakingCount > 0 ? '⚠' : '✓'}
            </span>{' '}
            Analysis complete — {breakingCount > 0 ? `${breakingCount} breaking changes` : '0 breaking changes'} across {languageCount} language{languageCount !== 1 ? 's' : ''}
          </span>
        ) : (
          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {[0, 1, 2].map(i => (
                <motion.div
                  key={i}
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: 'var(--teal-hex)' }}
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                />
              ))}
            </div>
            <span className="font-mono text-[12px]" style={{ color: 'var(--text-2-hex)' }}>Analyzing...</span>
          </div>
        )}
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="font-mono text-[12px] px-3 py-1.5 rounded-md border cursor-pointer"
          style={{ color: 'var(--text-2-hex)', borderColor: 'var(--border-2-hex)', background: 'transparent' }}
        >
          Open Project
        </motion.button>

        <AnimatePresence mode="wait">
          <motion.button
            key={btnState}
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleRun}
            className="font-syne font-semibold text-[12px] px-4 py-1.5 rounded-md flex items-center gap-2 cursor-pointer"
            style={
              btnState === 'idle'
                ? { background: 'var(--teal-hex)', color: 'var(--void-hex)' }
                : btnState === 'running'
                ? { background: 'var(--raised-hex)', border: '1px solid var(--teal-hex)', color: 'var(--teal-hex)' }
                : { background: 'rgba(0,229,184,0.08)', border: '1px solid var(--teal-hex)', color: 'var(--teal-hex)' }
            }
          >
            {btnState === 'idle' && <><span className="w-2 h-2 rounded-full" style={{ background: '#28c840' }} /> Run Analysis</>}
            {btnState === 'running' && (
              <>
                {[0, 1, 2].map(i => (
                  <motion.span key={i} animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.2 }}>.</motion.span>
                ))}
                <span>Analyzing</span>
              </>
            )}
            {btnState === 'complete' && '✓ Complete'}
          </motion.button>
        </AnimatePresence>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-8 h-8 flex items-center justify-center rounded-md border cursor-pointer"
          style={{ borderColor: 'var(--border-2-hex)', color: 'var(--text-3-hex)' }}
        >
          ⚙
        </motion.button>
      </div>
    </div>
  );
};

export default TopBar;
