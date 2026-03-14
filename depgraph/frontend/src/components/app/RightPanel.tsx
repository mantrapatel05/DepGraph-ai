import { motion, AnimatePresence } from 'framer-motion';
import { useApp } from '@/context/AppContext';
import ImpactTab from './tabs/ImpactTab';
import ChatTab from './tabs/ChatTab';
import MigrateTab from './tabs/MigrateTab';
import VariableChain from './VariableChain';

const TABS = [
  { id: 'impact' as const,  label: 'IMPACT' },
  { id: 'chat' as const,    label: 'RAG CHAT', dot: true },
  { id: 'migrate' as const, label: 'MIGRATE' },
  { id: 'chains' as const,  label: 'CHAINS', dot: true },
];

const RightPanel = () => {
  const { activeTab, setActiveTab, chains, chainsLoading } = useApp();

  return (
    <div className="w-[360px] shrink-0 flex flex-col border-l overflow-hidden" style={{ background: 'var(--base-hex)', borderColor: 'var(--border-1-hex)' }}>
      {/* Tab bar */}
      <div className="relative flex border-b" style={{ borderColor: 'var(--border-1-hex)' }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="flex-1 py-3 flex items-center justify-center gap-1.5 font-syne font-semibold text-[11px] tracking-[0.1em] uppercase relative cursor-pointer"
            style={{ color: activeTab === tab.id ? 'var(--text-1-hex)' : 'var(--text-3-hex)' }}
          >
            {tab.label}
            {tab.dot && <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: 'var(--teal-hex)' }} />}
            {activeTab === tab.id && (
              <motion.div
                layoutId="tab-indicator"
                className="absolute bottom-0 left-0 right-0 h-[2px]"
                style={{ background: 'var(--teal-hex)' }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
            className="h-full"
          >
            {activeTab === 'impact' && <ImpactTab />}
            {activeTab === 'chat' && <ChatTab />}
            {activeTab === 'migrate' && <MigrateTab />}
            {activeTab === 'chains' && <VariableChain chains={chains} loading={chainsLoading} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
};

export default RightPanel;
