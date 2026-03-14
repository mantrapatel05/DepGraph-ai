/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useMemo, useCallback, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type NodeTypes,
  type EdgeTypes,
  BaseEdge,
  getBezierPath,
  type EdgeProps,
  BackgroundVariant,
  Panel,
  MiniMap,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from '@dagrejs/dagre';
import { useApp } from '@/context/AppContext';

// ─── Constants ────────────────────────────────────────────────────────────────

const ZONE: Record<string, { color: string; label: string }> = {
  database: { color: '#f59e0b', label: 'DATABASE'  },
  backend:  { color: '#a78bfa', label: 'BACKEND'   },
  frontend: { color: '#38bdf8', label: 'FRONTEND'  },
};

const NODE_W  = 220;
const NODE_H  = 118;

// Target x-center for each zone after dagre layout
const ZONE_TARGET_X: Record<string, number> = { database: 180, backend: 680, frontend: 1200 };
const ZONE_BAND_W   = 380;   // max spread within a zone column
const ZONE_BG_PAD   = 28;

const CHAIN_EDGE_TYPES = new Set([
  'ORM_MAP', 'CONVENTION_MAP', 'SCHEMA_MAP', 'RENDERS',
  'SERIALIZES_TO', 'FLOWS_TO', 'MAPS_TO',
]);

const EDGE_COLOR: Record<string, string> = {
  ORM_MAP:        '#00e5b8',
  MAPS_TO:        '#00e5b8',
  CONVENTION_MAP: '#38bdf8',
  SERIALIZES_TO:  '#38bdf8',
  SCHEMA_MAP:     '#a78bfa',
  RENDERS:        '#34d399',
  EXPOSES_AS:     '#818cf8',
  FLOWS_TO:       '#7c3aed',
};

const TYPE_LABEL: Record<string, string> = {
  column: 'Column', table: 'Table', variable: 'Variable',
  function: 'Method', class: 'Class', interface: 'Interface',
  route: 'Route', file: 'File',
};

const LANG_LAYER: Record<string, string> = {
  sql: 'database', python: 'backend',
  typescript: 'frontend', react: 'frontend', javascript: 'frontend',
};

const LAYER_ORDER = ['database', 'backend', 'frontend'];

function nodeLayer(n: any): string {
  return n?.layer || LANG_LAYER[n?.language || ''] || 'backend';
}

// ─── Dagre layout with zone snapping ─────────────────────────────────────────

function buildLayout(graphNodes: any[], graphEdges: any[]) {
  if (!graphNodes.length) return { rfNodes: [], rfEdges: [] };

  // Only show nodes that appear in at least one edge
  const connectedIds = new Set<string>();
  graphEdges.forEach(e => { connectedIds.add(e.source); connectedIds.add(e.target); });
  const nodes = graphNodes.filter(n => connectedIds.has(n.id));
  if (!nodes.length) return { rfNodes: [], rfEdges: [] };

  // Run dagre to get organic topology-based positions
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'LR', ranksep: 260, nodesep: 50, marginx: 40, marginy: 40 });

  nodes.forEach(n => g.setNode(n.id, { width: NODE_W, height: NODE_H }));

  const seenEdge = new Set<string>();
  graphEdges.forEach(e => {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) return;
    const k = `${e.source}|||${e.target}`;
    if (!seenEdge.has(k)) { seenEdge.add(k); g.setEdge(e.source, e.target); }
  });

  dagre.layout(g);

  // Collect dagre x values per zone so we can normalize
  const zoneXBucket: Record<string, number[]> = {};
  nodes.forEach(n => {
    const pos = g.node(n.id);
    if (!pos) return;
    (zoneXBucket[nodeLayer(n)] ??= []).push(pos.x);
  });

  // Map each node's dagre x → zone-band x
  const rfNodes: any[] = [];
  const layerBounds: Record<string, { minX: number; maxX: number; minY: number; maxY: number }> = {};

  nodes.forEach(n => {
    const pos = g.node(n.id);
    if (!pos) return;
    const layer  = nodeLayer(n);
    const xs     = zoneXBucket[layer] ?? [];
    const dMin   = xs.length ? Math.min(...xs) : pos.x;
    const dMax   = xs.length ? Math.max(...xs) : pos.x;
    const dSpan  = dMax > dMin ? dMax - dMin : 1;
    const norm   = (pos.x - dMin) / dSpan - 0.5;           // -0.5 … +0.5
    const center = ZONE_TARGET_X[layer] ?? 680;
    const finalX = center + norm * ZONE_BAND_W - NODE_W / 2;
    const finalY = pos.y - NODE_H / 2;

    rfNodes.push({
      id: n.id,
      type: 'codeNode',
      position: { x: finalX, y: finalY },
      data: { ...n, _layer: layer },
      style: { width: NODE_W },
      zIndex: 10,
    });

    const b = layerBounds[layer] ??= { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    b.minX = Math.min(b.minX, finalX);
    b.maxX = Math.max(b.maxX, finalX + NODE_W);
    b.minY = Math.min(b.minY, finalY);
    b.maxY = Math.max(b.maxY, finalY + NODE_H);
  });

  // Zone backgrounds
  const bgNodes = Object.entries(ZONE)
    .filter(([key]) => layerBounds[key])
    .map(([key, zone]) => {
      const b = layerBounds[key];
      const w = b.maxX - b.minX + ZONE_BG_PAD * 4;
      const h = b.maxY - b.minY + ZONE_BG_PAD * 4;
      return {
        id: `zone-bg-${key}`,
        type: 'zoneBg',
        position: { x: b.minX - ZONE_BG_PAD * 2, y: b.minY - ZONE_BG_PAD * 2 },
        data: { color: zone.color, width: w, height: h, label: zone.label },
        selectable: false, draggable: false, connectable: false,
        zIndex: -20,
        style: { width: w, height: h, pointerEvents: 'none' },
      };
    });

  // Edges
  const posIds = new Set(rfNodes.map(n => n.id));
  const rfEdges = graphEdges
    .filter(e => posIds.has(e.source) && posIds.has(e.target))
    .map(e => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'depEdge',
      animated: e.data?.break_risk === 'high',
      zIndex: 20,
      data: {
        edgeType:    e.data?.type        || 'FLOWS_TO',
        breakRisk:   e.data?.break_risk  || 'none',
        inferredBy:  e.data?.inferred_by || 'ast',
        confidence:  e.data?.confidence  ?? 0.5,
        isChainEdge: CHAIN_EDGE_TYPES.has(e.data?.type),
      },
    }));

  return { rfNodes: [...bgNodes, ...rfNodes], rfEdges };
}

// ─── Trail computation: BFS forward + backward from a clicked node ────────────

interface Trail {
  nodeIds:  Set<string>;
  edgeIds:  Set<string>;
  // Ordered chain: upstream nodes → selected → downstream nodes
  chain:    string[];
}

function computeTrail(nodeId: string, nodes: any[], edges: any[]): Trail {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    (outgoing.get(e.source) ?? outgoing.set(e.source, []).get(e.source)!).push(e.target);
    (incoming.get(e.target) ?? incoming.set(e.target, []).get(e.target)!).push(e.source);
  }

  const bfs = (start: string, adj: Map<string, string[]>) => {
    const visited = new Set<string>();
    const queue = [start];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of adj.get(cur) ?? []) {
        if (!visited.has(next)) { visited.add(next); queue.push(next); }
      }
    }
    return visited;
  };

  const downstream = bfs(nodeId, outgoing);
  const upstream   = bfs(nodeId, incoming);
  const nodeIds    = new Set([nodeId, ...upstream, ...downstream]);

  const edgeIds = new Set(
    edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target)).map(e => e.id)
  );

  // Build ordered chain: sort by layer, prefer shortest direct path
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const chain = LAYER_ORDER.flatMap(layer =>
    [...nodeIds]
      .filter(id => nodeLayer(nodeMap.get(id)) === layer)
      .sort((a, b) => {
        // prefer cross-language nodes first
        const aOut = (outgoing.get(a) ?? []).filter(t => nodeLayer(nodeMap.get(t)) !== layer).length;
        const bOut = (outgoing.get(b) ?? []).filter(t => nodeLayer(nodeMap.get(t)) !== layer).length;
        return bOut - aOut;
      })
      .slice(0, 3) // max 3 per layer for readability
  );

  return { nodeIds, edgeIds, chain };
}

// ─── Zone background ─────────────────────────────────────────────────────────

const ZoneBg = ({ data }: any) => (
  <div style={{
    width: data.width, height: data.height,
    background: `${data.color}06`,
    border: `1px solid ${data.color}1a`,
    borderRadius: 14, pointerEvents: 'none',
    boxShadow: `inset 0 0 60px ${data.color}04`,
  }}>
    <div style={{
      position: 'absolute', top: 10, left: 0, right: 0, textAlign: 'center',
      fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 700,
      letterSpacing: '0.18em', color: `${data.color}55`,
    }}>
      {data.label}
    </div>
  </div>
);

// ─── Code node ────────────────────────────────────────────────────────────────

const CodeNode = ({ data, selected }: any) => {
  const layer   = data._layer || nodeLayer(data);
  const color   = ZONE[layer]?.color || '#4a6888';
  const tier    = data.severity?.tier;
  const isCrit  = tier === 'CRITICAL' || tier === 'HIGH';
  const label   = TYPE_LABEL[data.type] || data.type || '';
  const file    = (data.file || '').split(/[/\\]/).pop() || '';

  const preview = useMemo(() => {
    const src = (data.source_lines || '').trim();
    if (src) return src.split('\n').filter((l: string) => l.trim()).slice(0, 3).join('\n');
    if (data.language === 'sql'        && data.type === 'column')   return `${data.name} VARCHAR(255)`;
    if (data.language === 'sql'        && data.type === 'table')    return `TABLE ${data.name} (...)`;
    if (data.language === 'python'     && data.type === 'class')    return `class ${data.name}:`;
    if (data.language === 'python'     && data.type === 'function') return `def ${data.name}(self):`;
    if (data.language === 'python'     && data.type === 'variable') return `${data.name} = Column(...)`;
    if (data.language === 'typescript' && data.type === 'variable') return `${data.name}: string;`;
    if (data.language === 'typescript' && data.type === 'class')    return `interface ${data.name} {`;
    if (data.language === 'react'      && data.type === 'variable') return `{data.${data.name}}`;
    return data.name;
  }, [data]);

  return (
    <div style={{
      width: NODE_W,
      background: selected ? 'rgba(0,229,184,0.1)' : isCrit ? 'rgba(255,87,51,0.07)' : 'rgba(7,14,26,0.97)',
      border: `1.5px solid ${selected ? '#00e5b8' : isCrit ? '#ff573388' : color + '44'}`,
      borderRadius: 10, overflow: 'hidden',
      fontFamily: 'Fragment Mono, monospace',
      boxShadow: selected
        ? `0 0 24px rgba(0,229,184,0.25), 0 2px 12px rgba(0,0,0,0.6)`
        : isCrit
        ? `0 0 16px rgba(255,87,51,0.15)`
        : `0 2px 8px rgba(0,0,0,0.4)`,
      cursor: 'pointer',
      transition: 'box-shadow 0.15s, border-color 0.15s',
    }}>
      <Handle type="target" position={Position.Left}
        style={{ background: color, width: 9, height: 9, border: `2px solid #07080e`, left: -6 }} />
      <Handle type="source" position={Position.Right}
        style={{ background: color, width: 9, height: 9, border: `2px solid #07080e`, right: -6 }} />

      <div style={{ height: 3, background: `linear-gradient(90deg, ${color}, ${color}66)` }} />

      <div style={{
        background: `${color}10`, borderBottom: `1px solid ${color}20`,
        padding: '4px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <span style={{ color: `${color}aa`, fontSize: 9, letterSpacing: '0.04em',
          maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {file}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.18)', fontSize: 8 }}>:{data.line_start}</span>
      </div>

      <div style={{
        padding: '7px 10px 3px',
        color: selected ? '#00e5b8' : '#e8f4ff',
        fontSize: 13, fontWeight: 700,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>
        {data.name}
      </div>

      <div style={{
        margin: '0 8px 5px',
        background: 'rgba(0,0,0,0.28)', border: '1px solid rgba(255,255,255,0.04)',
        borderRadius: 5, padding: '4px 8px',
        fontSize: 9, color: '#5a8aa8',
        whiteSpace: 'pre', overflow: 'hidden', maxHeight: 40, lineHeight: 1.6,
      }}>
        {preview}
      </div>

      <div style={{ padding: '3px 10px 7px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 9, color: `${color}80`, letterSpacing: '0.05em' }}>{label}</span>
        {isCrit ? (
          <span style={{ fontSize: 8, fontWeight: 800, color: '#ff5733',
            background: 'rgba(255,87,51,0.12)', border: '1px solid rgba(255,87,51,0.3)',
            borderRadius: 3, padding: '1px 5px', letterSpacing: '0.08em' }}>CRITICAL</span>
        ) : data.is_boundary ? (
          <span style={{ fontSize: 8, fontWeight: 700, color, background: `${color}15`,
            border: `1px solid ${color}30`, borderRadius: 3, padding: '1px 5px',
            letterSpacing: '0.05em' }}>BOUNDARY</span>
        ) : null}
      </div>
    </div>
  );
};

// ─── Edge ─────────────────────────────────────────────────────────────────────

const DepEdge = ({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps) => {
  const [path] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, curvature: 0.3 });
  const edgeType   = (data as any)?.edgeType   || 'FLOWS_TO';
  const breakRisk  = (data as any)?.breakRisk  || 'none';
  const inferredBy = (data as any)?.inferredBy || 'ast';
  const isChain    = (data as any)?.isChainEdge as boolean;
  const isBreaking = breakRisk === 'high';
  const isTrail    = (data as any)?.isTrail as boolean;

  const color = isBreaking ? '#ff5733' : isTrail ? '#00e5b8' : isChain ? (EDGE_COLOR[edgeType] || '#38bdf8') : '#1e3248';
  const dash  = inferredBy === 'llm' ? '4 5' : inferredBy === 'naming' ? '8 4' : undefined;
  const w     = selected || isTrail ? 2.5 : isBreaking ? 2 : isChain ? 1.5 : 0.7;
  const op    = selected ? 1 : isTrail ? 0.9 : isBreaking ? 0.85 : isChain ? 0.5 : 0.2;

  return (
    <>
      {(isBreaking || isTrail) && (
        <BaseEdge path={path} style={{ stroke: color, strokeWidth: 12, opacity: 0.06 }} />
      )}
      <BaseEdge path={path} style={{ stroke: color, strokeWidth: w, strokeDasharray: dash, opacity: op }} />
    </>
  );
};

// ─── Trail panel ──────────────────────────────────────────────────────────────

const TrailPanel = ({ trail, nodes, edges, onClose }: {
  trail: Trail; nodes: any[]; edges: any[]; onClose: () => void;
}) => {
  const nodeMap  = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
  const edgeMap  = useMemo(() => {
    const m = new Map<string, any[]>();
    edges.forEach(e => { (m.get(e.source) ?? m.set(e.source, []).get(e.source)!).push(e); });
    return m;
  }, [edges]);

  const chain = trail.chain;

  return (
    <div style={{
      position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(5,10,18,0.97)', backdropFilter: 'blur(18px)',
      border: '1px solid rgba(0,229,184,0.25)', borderRadius: 12,
      padding: '12px 20px 14px', zIndex: 100,
      maxWidth: '90vw', overflow: 'auto',
      boxShadow: '0 4px 32px rgba(0,229,184,0.12)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontFamily: 'Syne, sans-serif', fontSize: 9, fontWeight: 700,
          letterSpacing: '0.16em', color: '#00e5b888' }}>
          VARIABLE TRAIL &nbsp;·&nbsp; {trail.nodeIds.size} nodes
        </span>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)',
          cursor: 'pointer', fontSize: 13, padding: '0 4px', lineHeight: 1,
        }}>✕</button>
      </div>

      {/* Chain */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'nowrap' }}>
        {chain.map((id, idx) => {
          const n     = nodeMap.get(id);
          if (!n) return null;
          const layer = nodeLayer(n);
          const color = ZONE[layer]?.color || '#4a6888';
          // Find edge to next node in chain
          const nextId  = chain[idx + 1];
          const linkEdge = nextId ? edgeMap.get(id)?.find(e => e.target === nextId) : null;
          const etype   = linkEdge?.data?.type || '';

          return (
            <React.Fragment key={id}>
              {/* Node chip */}
              <div style={{
                background: `${color}12`, border: `1px solid ${color}40`,
                borderRadius: 7, padding: '5px 10px', flexShrink: 0,
                fontFamily: 'Fragment Mono, monospace',
              }}>
                <div style={{ fontSize: 7, color: `${color}88`, letterSpacing: '0.1em', marginBottom: 2 }}>
                  {ZONE[layer]?.label}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#e8f4ff',
                  maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {n.name}
                </div>
                <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.25)', marginTop: 2 }}>
                  {TYPE_LABEL[n.type] || n.type}
                </div>
              </div>

              {/* Arrow */}
              {nextId && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center',
                  padding: '0 4px', flexShrink: 0 }}>
                  <div style={{ fontSize: 7, color: EDGE_COLOR[etype] || '#3a5a78',
                    letterSpacing: '0.06em', marginBottom: 2, whiteSpace: 'nowrap' }}>
                    {etype}
                  </div>
                  <div style={{ color: '#2a4060', fontSize: 13 }}>→</div>
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

// ─── Node / edge type maps ────────────────────────────────────────────────────

const nodeTypes: NodeTypes = { codeNode: CodeNode, zoneBg: ZoneBg } as any;
const edgeTypes: EdgeTypes = { depEdge: DepEdge as any };

// ─── Main canvas ──────────────────────────────────────────────────────────────

const GraphCanvas: React.FC = () => {
  const { graphData, selectedNode, selectNode, filterBreakingOnly, filterHideLowConf } = useApp();
  const [trail, setTrail] = useState<Trail | null>(null);

  // Apply sidebar filters
  const filteredData = useMemo(() => {
    if (!graphData) return graphData;
    let nodes = graphData.nodes as any[];
    let edges = graphData.edges as any[];

    if (filterBreakingOnly) {
      const breakIds = new Set<string>();
      edges.filter((e: any) => e.data?.break_risk === 'high')
        .forEach((e: any) => { breakIds.add(e.source); breakIds.add(e.target); });
      nodes = nodes.filter((n: any) => breakIds.has(n.id));
      edges = edges.filter((e: any) => breakIds.has(e.source) && breakIds.has(e.target));
    }

    if (filterHideLowConf) {
      edges = edges.filter((e: any) => (e.data?.confidence ?? 1) >= 0.7);
    }

    return { nodes, edges };
  }, [graphData, filterBreakingOnly, filterHideLowConf]);

  const { rfNodes, rfEdges } = useMemo(
    () => buildLayout(filteredData?.nodes || [], filteredData?.edges || []),
    [filteredData],
  );

  // Stamp trail flag onto edges for DepEdge rendering
  const markedEdges = useMemo(() => {
    if (!trail) return rfEdges;
    return rfEdges.map(e => ({
      ...e,
      data: { ...e.data, isTrail: trail.edgeIds.has(e.id) },
    }));
  }, [rfEdges, trail]);

  // Opacity: trail nodes full, others dim; if no trail use selectedNode neighbour logic
  const styledNodes = useMemo(() => {
    const isDecor = (id: string) => id.startsWith('zone-bg-');

    return rfNodes.map(n => {
      const inTrail   = trail ? trail.nodeIds.has(n.id)  : null;
      const isSelected = n.id === selectedNode;

      let opacity = 1;
      if (isDecor(n.id)) opacity = 1;
      else if (trail) opacity = inTrail ? 1 : 0.08;
      else if (selectedNode) {
        const neighbors = new Set([selectedNode]);
        filteredData?.edges.forEach((e: any) => {
          if (e.source === selectedNode) neighbors.add(e.target);
          if (e.target === selectedNode) neighbors.add(e.source);
        });
        opacity = neighbors.has(n.id) ? 1 : 0.1;
      }

      return { ...n, selected: isSelected, style: { ...n.style, opacity, transition: 'opacity 0.15s' } };
    });
  }, [rfNodes, trail, selectedNode, filteredData]);

  const styledEdges = useMemo(() =>
    markedEdges.map(e => ({
      ...e,
      selected: e.source === selectedNode || e.target === selectedNode,
      style: {
        opacity: trail
          ? (trail.edgeIds.has(e.id) ? 1 : 0.04)
          : selectedNode
          ? (e.source === selectedNode || e.target === selectedNode ? 1 : 0.04)
          : 1,
        transition: 'opacity 0.15s',
      },
    })),
    [markedEdges, trail, selectedNode],
  );

  const onNodeClick = useCallback((_: any, node: any) => {
    if (node.id.startsWith('zone-bg-')) return;
    if (node.id === selectedNode) {
      selectNode(null);
      setTrail(null);
      return;
    }
    selectNode(node.id);
    if (filteredData) {
      setTrail(computeTrail(node.id, filteredData.nodes as any[], filteredData.edges as any[]));
    }
  }, [selectNode, selectedNode, filteredData]);

  const onPaneClick = useCallback(() => { selectNode(null); setTrail(null); }, [selectNode]);

  if (!filteredData?.nodes?.length) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: '#04070d' }}>
        <div style={{ color: '#4a6888', fontFamily: 'Fragment Mono, monospace', fontSize: 13, textAlign: 'center', lineHeight: 1.9 }}>
          No graph data.<br />
          <span style={{ color: '#2a4060' }}>Run analysis to build the knowledge graph.</span>
        </div>
      </div>
    );
  }

  const breakEdges = rfEdges.filter(e => e.data?.breakRisk === 'high').length;
  const aiEdges    = rfEdges.filter(e => e.data?.inferredBy === 'llm').length;

  return (
    <div style={{ flex: 1, background: '#04070d', width: '100%', height: '100%', minHeight: 400, position: 'relative' }}>
      <ReactFlow
        nodes={styledNodes}
        edges={styledEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        fitView
        fitViewOptions={{ padding: 0.06 }}
        minZoom={0.02}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        style={{ background: '#04070d' }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} color="#0c1b2a" />

        <Controls style={{ background: 'rgba(7,13,22,0.92)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8 }} showInteractive={false} />

        <MiniMap
          style={{ background: 'rgba(7,13,22,0.92)', border: '1px solid rgba(255,255,255,0.06)' }}
          nodeColor={(n: any) => {
            if (n.id.startsWith('zone-')) return 'transparent';
            const layer = n.data?._layer || LANG_LAYER[n.data?.language || ''] || 'backend';
            return ZONE[layer]?.color || '#4a6888';
          }}
          maskColor="rgba(4,7,13,0.78)"
        />

        {/* Legend */}
        <Panel position="bottom-left">
          <div style={{
            background: 'rgba(6,12,22,0.95)', backdropFilter: 'blur(14px)',
            border: '1px solid rgba(255,255,255,0.06)', borderRadius: 10,
            padding: '10px 14px', fontFamily: 'Fragment Mono, monospace',
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', color: '#3a5a78', marginBottom: 8, fontFamily: 'Syne, sans-serif' }}>
              EDGE TYPES
            </div>
            {([
              { color: '#00e5b8', label: 'ORM_MAP',        dash: false },
              { color: '#38bdf8', label: 'CONVENTION_MAP', dash: true  },
              { color: '#a78bfa', label: 'SCHEMA_MAP',     dash: true  },
              { color: '#34d399', label: 'RENDERS',        dash: false },
              { color: '#ff5733', label: 'CRITICAL BREAK', dash: false },
              { color: '#7a9ab8', label: 'LLM Inferred',   dash: true  },
            ] as const).map(e => (
              <div key={e.label} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <svg width="22" height="6" style={{ flexShrink: 0 }}>
                  <line x1="0" y1="3" x2="22" y2="3" stroke={e.color} strokeWidth="2" strokeDasharray={e.dash ? '6 3' : undefined} />
                </svg>
                <span style={{ fontSize: 9, color: '#7a9ab8' }}>{e.label}</span>
              </div>
            ))}
            {trail && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <svg width="22" height="6"><line x1="0" y1="3" x2="22" y2="3" stroke="#00e5b8" strokeWidth="2.5" /></svg>
                  <span style={{ fontSize: 9, color: '#00e5b8' }}>Active Trail</span>
                </div>
              </div>
            )}
          </div>
        </Panel>

        {/* Stats */}
        <Panel position="top-right">
          <div style={{
            background: 'rgba(6,12,22,0.92)', border: '1px solid rgba(255,255,255,0.05)',
            borderRadius: 7, padding: '6px 12px',
            fontFamily: 'Fragment Mono, monospace', fontSize: 9, lineHeight: 1.9,
          }}>
            <div style={{ color: '#3a5a78' }}>{filteredData.nodes.length} nodes · {filteredData.edges.length} edges</div>
            {breakEdges > 0 && <div style={{ color: '#ff573388' }}>⚠ {breakEdges} breaking</div>}
            {aiEdges    > 0 && <div style={{ color: '#7c3aed88' }}>✦ {aiEdges} AI edges</div>}
            {trail && <div style={{ color: '#00e5b8' }}>⟡ trail: {trail.nodeIds.size} nodes</div>}
          </div>
        </Panel>

        {/* Click hint */}
        {!selectedNode && !trail && (
          <Panel position="top-center">
            <div style={{
              fontFamily: 'Fragment Mono, monospace', fontSize: 9,
              color: 'rgba(255,255,255,0.2)', background: 'rgba(5,10,18,0.8)',
              border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6,
              padding: '4px 14px', marginTop: 8,
            }}>
              Click any node to trace its variable trail through DB → Backend → Frontend
            </div>
          </Panel>
        )}
      </ReactFlow>

      {/* Trail panel overlay */}
      {trail && filteredData && (
        <TrailPanel
          trail={trail}
          nodes={filteredData.nodes as any[]}
          edges={filteredData.edges as any[]}
          onClose={() => { setTrail(null); selectNode(null); }}
        />
      )}
    </div>
  );
};

export default GraphCanvas;
