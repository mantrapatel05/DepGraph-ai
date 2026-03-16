import { motion } from 'framer-motion';
import { useState, useMemo } from 'react';
import { useApp } from '@/context/AppContext';

export const LANG_COLORS: Record<string, string> = {
  sql: '#d97706',
  python: '#7c3aed',
  typescript: '#2563eb',
  react: '#059669',
};

export const LANG_LABELS: Record<string, string> = {
  sql: 'DATA',
  python: 'BACK',
  typescript: 'API',
  react: 'UI',
};

interface FileItem {
  name: string;
  lang: string;
  breaking: boolean;
  indent: number;
  isFolder?: boolean;
  children?: FileItem[];
  fullPath?: string;
}

const langDimBg: Record<string, string> = {
  sql: 'rgba(245,158,11,0.12)',
  python: 'rgba(167,139,250,0.12)',
  typescript: 'rgba(56,189,248,0.12)',
  react: 'rgba(52,211,153,0.12)',
};

const langBorder: Record<string, string> = {
  sql: 'rgba(245,158,11,0.3)',
  python: 'rgba(167,139,250,0.3)',
  typescript: 'rgba(56,189,248,0.3)',
  react: 'rgba(52,211,153,0.3)',
};

const FileRow = ({ item }: { item: FileItem }) => {
  const { selectedNode, selectNode } = useApp();
  const [open, setOpen] = useState(true);
  const isSelected = selectedNode && item.fullPath && selectedNode.includes(item.fullPath);

  if (item.isFolder) {
    return (
      <div>
        <motion.div
          whileHover={{ backgroundColor: 'var(--raised-hex)', x: 2 }}
          transition={{ duration: 0.15 }}
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 px-3 py-1 cursor-pointer font-syne font-medium text-[13px]"
          style={{ paddingLeft: `${12 + item.indent * 16}px`, color: 'var(--text-3-hex)' }}
        >
          <span className="text-[10px]">{open ? '▼' : '▶'}</span>
          {item.name}
        </motion.div>
        {open && item.children?.map((c, i) => <FileRow key={i} item={c} />)}
      </div>
    );
  }

  return (
    <motion.div
      whileHover={{ backgroundColor: 'var(--raised-hex)', x: 2 }}
      transition={{ duration: 0.15 }}
      onClick={() => item.fullPath && selectNode?.(item.fullPath)}
      className="flex items-center gap-2 px-3 py-1.5 cursor-pointer"
      style={{
        paddingLeft: `${12 + item.indent * 16}px`,
        ...(isSelected ? { background: 'var(--raised-hex)', borderLeft: '2px solid var(--teal-hex)' } : {}),
      }}
    >
      <span className="text-[12px]" style={{ color: item.breaking ? 'var(--orange-hex)' : 'var(--text-4-hex)' }}>
        {item.breaking ? '⊗' : '📄'}
      </span>
      <span className="font-mono text-[12px] flex-1 truncate" style={{ color: 'var(--text-1-hex)' }}>{item.name}</span>
      {item.lang && (
        <span
          className="font-mono text-[9px] px-1.5 py-0.5 rounded-sm"
          style={{
            background: langDimBg[item.lang] || 'rgba(255,255,255,0.1)',
            color: LANG_COLORS[item.lang] || '#fff',
            border: `1px solid ${langBorder[item.lang] || 'rgba(255,255,255,0.3)'}`,
          }}
        >
          {LANG_LABELS[item.lang] || item.lang}
        </span>
      )}
    </motion.div>
  );
};

const LeftSidebar = () => {
  const { filterBreakingOnly, setFilterBreakingOnly, filterHideLowConf, setFilterHideLowConf, graphData } = useApp();

  const [search, setSearch] = useState('');

  const { tree, stats } = useMemo(() => {
    if (!graphData) return { tree: [], stats: { nodes: 0, breaking: 0, aiEdges: 0 } };

    let breakingCount = 0;
    
    // Compute severity per node from edges (target side)
    const nodeSeverity: Record<string, boolean> = {};
    graphData.edges.forEach(e => {
      const risk = (e.data as any)?.break_risk;
      if (risk === 'HIGH' || risk === 'CRITICAL' || risk === 'high' || risk === 'critical') {
        nodeSeverity[e.target] = true;
      }
    });

    graphData.nodes.forEach(n => {
        if (nodeSeverity[n.id]) breakingCount++;
    });

    const aiEdges = graphData.edges.filter(e => (e.data as any)?.inferred_by === 'llm').length;

    // Group nodes by file path
    const fileMap = new Map<string, FileItem[]>();
    graphData.nodes.forEach(n => {
      // Basic search filter
      if (search && !n.name.toLowerCase().includes(search.toLowerCase()) && !n.file.toLowerCase().includes(search.toLowerCase())) {
          return;
      }
      if (filterBreakingOnly && !nodeSeverity[n.id]) {
          return;
      }

      const filePath = n.file.split(/[/\\]/).pop() || n.file;
      const isBreaking = nodeSeverity[n.id] || false;
      
      const item: FileItem = {
        name: n.name,
        lang: n.language,
        breaking: isBreaking,
        indent: 1, // Nodes are children of the file
        fullPath: n.id // We use node ID for selection here
      };

      if (!fileMap.has(filePath)) {
        fileMap.set(filePath, []);
      }
      fileMap.get(filePath)!.push(item);
    });

    const tree: FileItem[] = Array.from(fileMap.entries()).map(([filePath, nodes]) => ({
      name: filePath,
      lang: '',
      breaking: nodes.some(n => n.breaking),
      indent: 0,
      isFolder: true,
      children: nodes
    }));

    return { 
        tree, 
        stats: { 
            nodes: graphData.nodes.length, 
            breaking: breakingCount, 
            aiEdges 
        } 
    };
  }, [graphData, filterBreakingOnly, search]);

  return (
    <div className="w-[280px] shrink-0 flex flex-col border-r overflow-y-auto" style={{ background: 'var(--base-hex)', borderColor: 'var(--border-1-hex)' }}>
      {/* Search */}
      <div className="p-3">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[12px]" style={{ color: 'var(--text-3-hex)' }}>🔍</span>
          <input
            placeholder="Search nodes, files..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full font-mono text-[12px] py-2 pl-9 pr-3 rounded-lg border outline-none transition-all duration-150 focus:shadow-[0_0_0_3px_rgba(0,229,184,0.08)]"
            style={{
              background: 'var(--surface-hex)',
              borderColor: 'var(--border-1-hex)',
              color: 'var(--text-2-hex)',
            }}
            onFocus={e => e.currentTarget.style.borderColor = 'var(--teal-hex)'}
            onBlur={e => e.currentTarget.style.borderColor = 'var(--border-1-hex)'}
          />
        </div>
      </div>

      {/* Filters */}
      <div className="px-3 space-y-1.5">
        <label className="flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-opacity-5 text-[12px] font-syne" style={{ color: 'var(--text-2-hex)' }}>
          <input type="checkbox" checked={filterBreakingOnly} onChange={e => setFilterBreakingOnly(e.target.checked)}
            className="w-3.5 h-3.5" style={{ accentColor: 'var(--teal-hex)' }} />
          Only Show Breaking Nodes
        </label>
        <label className="flex items-center gap-2 py-1 px-2 rounded cursor-pointer hover:bg-opacity-5 text-[12px] font-syne" style={{ color: 'var(--text-2-hex)' }}>
          <input type="checkbox" checked={filterHideLowConf} onChange={e => setFilterHideLowConf(e.target.checked)}
            className="w-3.5 h-3.5" style={{ accentColor: 'var(--teal-hex)' }} />
          Hide Low Confidence Edges
        </label>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-0 px-3 py-3 mt-2 border-y" style={{ borderColor: 'var(--border-1-hex)' }}>
        <span className="flex-1 text-center font-mono text-[11px]" style={{ color: 'var(--text-3-hex)' }}>{stats.nodes} Nodes</span>
        <span className="w-px h-3" style={{ background: 'var(--border-1-hex)' }} />
        <span className="flex-1 text-center font-mono text-[11px] flex items-center justify-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: 'var(--orange-hex)' }} />
          <span style={{ color: 'var(--orange-hex)' }}>{stats.breaking} Breaking</span>
        </span>
        <span className="w-px h-3" style={{ background: 'var(--border-1-hex)' }} />
        <span className="flex-1 text-center font-mono text-[11px]" style={{ color: 'var(--teal-hex)' }}>{stats.aiEdges} AI Edges</span>
      </div>

      {/* Section header */}
      <div className="px-4 pt-4 pb-2">
        <span className="font-syne font-semibold text-[10px] tracking-[0.15em] uppercase" style={{ color: 'var(--text-4-hex)' }}>
          PROJECT TREE
        </span>
      </div>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto pb-4">
        {tree.map((item, i) => <FileRow key={i} item={item} />)}
      </div>

      {/* Bottom */}
      <div className="p-3 border-t space-y-0.5" style={{ borderColor: 'var(--border-1-hex)' }}>
        <div className="font-mono text-[10px]" style={{ color: 'var(--text-4-hex)' }}>Engine: tree-sitter + NetworkX</div>
        <div className="font-mono text-[10px]" style={{ color: 'var(--text-4-hex)' }}>Lang: SQL · Python · TS · React</div>
      </div>
    </div>
  );
};

export default LeftSidebar;
