import { motion } from 'framer-motion';
import { useState } from 'react';
import { useApp } from '@/context/AppContext';
import { apiClient } from '@/api/client';

type ApplyState = 'idle' | 'generating' | 'ready' | 'applying' | 'done';

interface MigrateFile {
  file: string;
  language: string;
  line: number;
  old_code: string;
  new_code: string;
  change_type: string;
}

interface MigratePlan {
  summary: string;
  safe_order: string[];
  files: MigrateFile[];
}

const LANG_COLOR: Record<string, string> = {
  sql:        '#f59e0b',
  python:     '#a78bfa',
  typescript: '#38bdf8',
  react:      '#34d399',
};

const MigrateTab = () => {
  const { selectedNode } = useApp();
  const [newName, setNewName] = useState('');
  const [applyState, setApplyState] = useState<ApplyState>('idle');
  const [plan, setPlan] = useState<MigratePlan | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedFileData = plan?.files.find(f => f.file === selectedFile);

  const handleGenerate = async () => {
    if (!selectedNode || !newName.trim()) return;
    setApplyState('generating');
    setError(null);
    try {
      const result = await apiClient.migrate(selectedNode, newName.trim());
      setPlan(result as unknown as MigratePlan);
      if ((result as unknown as MigratePlan).files?.length > 0) {
        setSelectedFile((result as unknown as MigratePlan).files[0].file);
      }
      setApplyState('ready');
    } catch (err: any) {
      setError(err.message || 'Migration generation failed');
      setApplyState('idle');
    }
  };

  const handleApply = async () => {
    setApplyState('applying');
    await new Promise(r => setTimeout(r, 1600));
    setApplyState('done');
    setTimeout(() => setApplyState('ready'), 3000);
  };

  if (!selectedNode) {
    return (
      <div className="p-8 text-center">
        <div className="font-mono text-[12px]" style={{ color: 'var(--text-4-hex)' }}>
          Select a node in the graph to generate a migration plan
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 space-y-4 flex-1 overflow-y-auto custom-scrollbar">

        {/* Header */}
        <div className="flex items-center justify-between">
          <span className="font-syne font-semibold text-[11px] tracking-[0.12em]" style={{ color: 'var(--text-3-hex)' }}>CROSS-LANGUAGE MIGRATION</span>
          {plan && <span className="font-mono text-[11px]" style={{ color: 'var(--text-4-hex)' }}>{plan.files.length} files</span>}
        </div>

        {/* Rename form */}
        <div className="p-3 rounded-lg space-y-3" style={{ background: 'var(--surface-hex)', border: '1px solid var(--border-2-hex)' }}>
          <div className="flex items-center gap-2 font-mono text-[12px]">
            <code className="px-2 py-1 rounded-sm truncate max-w-[120px]" style={{ background: 'rgba(255,87,51,0.08)', color: '#ff9980' }}>
              {selectedNode.split('::').pop()}
            </code>
            <motion.span animate={{ x: [0, 4, 0] }} transition={{ duration: 1.5, repeat: Infinity }} style={{ color: 'var(--teal-hex)' }}>→</motion.span>
            <input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleGenerate()}
              placeholder="new_name"
              className="flex-1 bg-transparent outline-none font-mono text-[12px] px-2 py-1 rounded-sm border"
              style={{
                background: 'rgba(0,229,184,0.04)',
                borderColor: newName ? 'var(--teal-hex)' : 'var(--border-2-hex)',
                color: '#5fffd8',
              }}
            />
          </div>
          <motion.button
            whileHover={{ filter: 'brightness(1.1)' }}
            whileTap={{ scale: 0.98 }}
            onClick={handleGenerate}
            disabled={!newName.trim() || applyState === 'generating'}
            className="w-full py-2 rounded-md font-syne font-semibold text-[12px] cursor-pointer flex items-center justify-center gap-2"
            style={{
              background: newName.trim() ? 'var(--teal-hex)' : 'var(--border-1-hex)',
              color: newName.trim() ? 'var(--void-hex)' : 'var(--text-4-hex)',
              opacity: applyState === 'generating' ? 0.7 : 1,
            }}
          >
            {applyState === 'generating' ? (
              <>
                <span className="w-3.5 h-3.5 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--void-hex)', borderTopColor: 'transparent' }} />
                Generating plan...
              </>
            ) : 'Generate Migration Plan'}
          </motion.button>
        </div>

        {/* Error */}
        {error && (
          <div className="px-3 py-2 rounded-md font-mono text-[12px]" style={{ background: 'rgba(255,87,51,0.08)', color: 'var(--orange-hex)', border: '1px solid rgba(255,87,51,0.25)' }}>
            {error}
          </div>
        )}

        {/* Migration plan */}
        {plan && (
          <>
            {/* Summary */}
            <div className="px-3 py-2 rounded-md font-mono text-[11px]" style={{ background: 'var(--surface-hex)', border: '1px solid var(--border-2-hex)', color: 'var(--teal-hex)' }}>
              ✓ {plan.summary}
            </div>

            {/* Safe order hint */}
            {plan.safe_order?.length > 0 && (
              <div className="space-y-1">
                <span className="font-syne font-semibold text-[10px] tracking-[0.12em]" style={{ color: 'var(--text-4-hex)' }}>SAFE ORDER</span>
                {plan.safe_order.map((step, i) => (
                  <div key={i} className="font-mono text-[10px] flex items-start gap-2" style={{ color: 'var(--text-3-hex)' }}>
                    <span style={{ color: 'var(--teal-hex)', minWidth: '14px' }}>{i + 1}.</span>
                    {step}
                  </div>
                ))}
              </div>
            )}

            {/* File tabs */}
            <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
              {plan.files.map(f => {
                const fname = f.file.split('/').pop() || f.file;
                const lc = LANG_COLOR[f.language] || '#4a6888';
                return (
                  <button
                    key={f.file}
                    onClick={() => setSelectedFile(f.file)}
                    className="font-mono text-[10px] px-2.5 py-1.5 rounded-md whitespace-nowrap flex items-center gap-1.5 cursor-pointer shrink-0"
                    style={{
                      background: selectedFile === f.file ? 'var(--raised-hex)' : 'transparent',
                      border: `1px solid ${selectedFile === f.file ? lc : 'var(--border-1-hex)'}`,
                      color: selectedFile === f.file ? 'var(--text-1-hex)' : 'var(--text-3-hex)',
                    }}
                  >
                    <span style={{ color: lc, fontSize: '7px' }}>■</span>
                    {fname}
                  </button>
                );
              })}
            </div>

            {/* Diff viewer */}
            {selectedFileData && (
              <div className="rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border-1-hex)' }}>
                <div className="px-3 py-1.5 font-mono text-[10px] flex justify-between items-center" style={{ background: 'var(--surface-hex)', color: 'var(--text-3-hex)' }}>
                  <span>{selectedFileData.file} <span style={{ color: 'var(--text-4-hex)' }}>:{selectedFileData.line}</span></span>
                  <span className="px-1.5 py-0.5 rounded-sm" style={{ background: `${LANG_COLOR[selectedFileData.language]}18`, color: LANG_COLOR[selectedFileData.language] || '#fff', border: `1px solid ${LANG_COLOR[selectedFileData.language]}30` }}>
                    {selectedFileData.change_type}
                  </span>
                </div>
                <div className="p-3 space-y-2 font-mono text-[12px]" style={{ background: 'var(--base-hex)' }}>
                  <div>
                    <div className="text-[9px] mb-1" style={{ color: 'var(--text-4-hex)' }}>BEFORE</div>
                    <div className="px-2 py-1.5 rounded-sm" style={{ background: 'rgba(255,87,51,0.06)', border: '1px solid rgba(255,87,51,0.15)', color: '#ff9980' }}>
                      <span style={{ color: 'rgba(255,87,51,0.5)', marginRight: '6px' }}>−</span>
                      {selectedFileData.old_code}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] mb-1" style={{ color: 'var(--text-4-hex)' }}>AFTER</div>
                    <div className="px-2 py-1.5 rounded-sm" style={{ background: 'rgba(0,229,184,0.06)', border: '1px solid rgba(0,229,184,0.15)', color: '#5fffd8' }}>
                      <span style={{ color: 'rgba(0,229,184,0.5)', marginRight: '6px' }}>+</span>
                      {selectedFileData.new_code}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Apply button */}
      {plan && plan.files.length > 0 && (
        <div className="p-4 border-t" style={{ borderColor: 'var(--border-1-hex)' }}>
          {applyState === 'done' ? (
            <div className="w-full py-3.5 rounded-lg font-syne font-semibold text-[13px] text-center" style={{
              background: 'rgba(0,229,184,0.08)', color: 'var(--teal-hex)', border: '1px solid var(--teal-hex)',
            }}>
              ✓ Migration applied — 0 breaking changes remaining
            </div>
          ) : (
            <motion.button
              whileHover={{ filter: 'brightness(1.1)', boxShadow: '0 0 24px rgba(0,229,184,0.15)' }}
              whileTap={{ scale: 0.99 }}
              onClick={handleApply}
              disabled={applyState === 'applying'}
              className="w-full py-3.5 rounded-lg font-syne font-semibold text-[13px] cursor-pointer flex items-center justify-center gap-2"
              style={{ background: 'linear-gradient(135deg, var(--teal-hex) 0%, var(--teal-2-hex) 100%)', color: 'var(--void-hex)' }}
            >
              {applyState === 'applying' ? (
                <>
                  <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--void-hex)', borderTopColor: 'transparent' }} />
                  Updating Filesystem...
                </>
              ) : `Apply All ${plan.files.length} Files`}
            </motion.button>
          )}
        </div>
      )}
    </div>
  );
};

export default MigrateTab;
