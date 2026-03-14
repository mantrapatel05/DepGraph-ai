/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-nocheck  — react-force-graph-3d + three-spritetext lack complete TS types
import React, {
  useRef,
  useEffect,
  useMemo,
  useCallback,
  useState,
} from 'react';
import ForceGraph3D from 'react-force-graph-3d';
import SpriteText from 'three-spritetext';
import * as THREE from 'three';
import { useApp } from '@/context/AppContext';

// ─── Constants ────────────────────────────────────────────────────────────────

const LAYER_COLORS: Record<string, string> = {
  database: '#f59e0b',
  backend:  '#a78bfa',
  frontend: '#38bdf8',
};

const LANG_TO_LAYER: Record<string, string> = {
  sql:        'database',
  python:     'backend',
  typescript: 'frontend',
  react:      'frontend',
  javascript: 'frontend',
};

const EDGE_COLORS: Record<string, string> = {
  MAPS_TO:           '#00e5b8',
  SERIALIZES_TO:     '#38bdf8',
  EXPOSES_AS:        '#818cf8',
  RENDERS:           '#34d399',
  FLOWS_TO:          '#7c3aed',
  TRANSFORMS:        '#f59e0b',
  BREAKS_IF_RENAMED: '#ff5733',
  CALLS:             '#4a6888',
  IMPORTS:           '#2a4060',
};

function getLayer(lang: string): string {
  return LANG_TO_LAYER[lang] || 'backend';
}

function getLayerColor(node: any): string {
  const layer = node.layer || getLayer(node.language || '');
  return LAYER_COLORS[layer] || '#4a6888';
}

// ─── 3-D Knowledge Graph Canvas ──────────────────────────────────────────────

const GraphCanvas: React.FC = () => {
  const { graphData, selectedNode, selectNode } = useApp();
  const fgRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Track container dimensions for the WebGL canvas
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width: Math.floor(width), height: Math.floor(height) });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Apply section-grouping forces after graph mounts
  useEffect(() => {
    if (!fgRef.current || !graphData?.nodes.length) return;
    const fg = fgRef.current;

    // Custom X force: push each node toward its section's X target
    fg.d3Force('section-x', (alpha: number) => {
      (fg.graphData().nodes as any[]).forEach((node: any) => {
        const layer = node.layer || getLayer(node.language || '');
        const tx = layer === 'database' ? -520 : layer === 'backend' ? 0 : 520;
        node.vx = ((node.vx as number) || 0) + (tx - ((node.x as number) || 0)) * alpha * 0.35;
      });
    });

    // Z-flatten force: keep graph in a 2.5-D plane
    fg.d3Force('z-flatten', (alpha: number) => {
      (fg.graphData().nodes as any[]).forEach((node: any) => {
        node.vz = ((node.vz as number) || 0) - ((node.z as number) || 0) * alpha * 0.15;
      });
    });

    fg.d3ReheatSimulation();
  }, [graphData]);

  // Selected + neighbor highlight set
  const highlightedIds = useMemo<Set<string>>(() => {
    if (!selectedNode || !graphData) return new Set();
    const s = new Set<string>([selectedNode]);
    graphData.edges.forEach(e => {
      if (e.source === selectedNode) s.add(e.target);
      if (e.target === selectedNode) s.add(e.source);
    });
    return s;
  }, [selectedNode, graphData]);

  // Convert edges → links (the library uses "links" not "edges")
  const fg3dData = useMemo(() => {
    if (!graphData) return { nodes: [], links: [] };
    const links = graphData.edges
      .map(edge => ({
        source:        edge.source,
        target:        edge.target,
        id:            edge.id,
        edgeType:      (edge.data as any)?.type || 'FLOWS_TO',
        confidence:    (edge.data as any)?.confidence ?? 0.5,
        breakRisk:     (edge.data as any)?.break_risk || 'none',
        inferredBy:    (edge.data as any)?.inferred_by || 'ast',
        transformation:(edge.data as any)?.transformation || '',
      }))
      .filter(l => l.source && l.target);
    return { nodes: graphData.nodes, links };
  }, [graphData]);

  // ── Custom Three.js node object ────────────────────────────────────────────
  const nodeThreeObject = useCallback((node: any) => {
    const color      = getLayerColor(node);
    const isSelected = selectedNode === node.id;
    const isHit      = highlightedIds.has(node.id);
    const isDimmed   = highlightedIds.size > 0 && !isHit;
    const isBoundary = node.is_boundary || false;
    const severity   = (node as any).severity?.tier as string | undefined;

    const group = new THREE.Group();

    // Sphere radius varies by significance
    const radius = isBoundary ? 7 : severity === 'CRITICAL' ? 9 : 5;
    const mat = new THREE.MeshPhongMaterial({
      color:             isSelected ? '#00e5b8' : color,
      emissive:          isSelected ? '#007a60' : (isBoundary ? color : '#000000'),
      emissiveIntensity: isSelected ? 0.7 : (isBoundary ? 0.25 : 0),
      transparent: true,
      opacity:     isDimmed ? 0.12 : 1,
      shininess:   60,
    });
    group.add(new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 20), mat));

    // Outer ring for boundary / selected
    if ((isBoundary || isSelected) && !isDimmed) {
      const ringMat = new THREE.MeshBasicMaterial({
        color, side: THREE.DoubleSide, transparent: true,
        opacity: isSelected ? 0.85 : 0.3,
      });
      group.add(new THREE.Mesh(new THREE.RingGeometry(radius + 2, radius + 4, 32), ringMat));
    }

    // Red glow halo for CRITICAL severity
    if (severity === 'CRITICAL' && !isDimmed) {
      group.add(new THREE.Mesh(
        new THREE.SphereGeometry(radius + 6, 16, 16),
        new THREE.MeshBasicMaterial({ color: '#ff5733', transparent: true, opacity: 0.10, side: THREE.BackSide }),
      ));
    }

    // Primary label sprite
    const label = (node.name as string) || (node.id as string)?.split('::').pop() || '';
    const sprite = new SpriteText(label);
    sprite.color      = isSelected ? '#00e5b8' : (isDimmed ? '#1e3048' : '#e8f0fa');
    sprite.textHeight = isSelected ? 9 : 5;
    sprite.position.y = radius + 11;
    group.add(sprite);

    // Sub-label on selected / highlighted
    if (isSelected || isHit) {
      const sub = new SpriteText(
        `[${node.type || '?'}] ${(node.file as string || '').split('/').pop()}`,
      );
      sub.color      = '#8da4bd';
      sub.textHeight = 3.5;
      sub.position.y = radius + 20;
      group.add(sub);
    }

    return group;
  }, [selectedNode, highlightedIds]);

  // ── Edge styling ───────────────────────────────────────────────────────────
  const linkColor = useCallback((link: any) => {
    const srcId = typeof link.source === 'object' ? link.source.id : link.source;
    const tgtId = typeof link.target === 'object' ? link.target.id : link.target;
    const connected = !selectedNode || srcId === selectedNode || tgtId === selectedNode;
    if (!connected) return 'rgba(20,35,55,0.12)';
    if (link.breakRisk === 'high') return '#ff5733';
    return EDGE_COLORS[link.edgeType as string] || '#2a4060';
  }, [selectedNode]);

  const linkWidth = useCallback((link: any) => {
    const srcId = typeof link.source === 'object' ? link.source.id : link.source;
    const tgtId = typeof link.target === 'object' ? link.target.id : link.target;
    const connected = !selectedNode || srcId === selectedNode || tgtId === selectedNode;
    if (link.breakRisk === 'high') return 1.8;
    return connected ? 0.8 : 0.15;
  }, [selectedNode]);

  const linkDirectionalParticles = useCallback(
    (link: any) => (link.breakRisk === 'high' ? 4 : 0),
    [],
  );

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!graphData || !graphData.nodes.length) {
    return (
      <div
        ref={containerRef}
        className="flex-1 flex items-center justify-center"
        style={{ background: '#04070d' }}
      >
        <div style={{
          color: '#4a6888', fontFamily: 'Fragment Mono, monospace', fontSize: '13px',
          textAlign: 'center', lineHeight: '1.8',
        }}>
          No graph data available.<br />
          <span style={{ color: '#2a4060' }}>Run analysis to build the knowledge graph.</span>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="flex-1 relative overflow-hidden"
      style={{ background: '#04070d', width: '100%', height: '100%', minHeight: 400 }}
    >
      {/* Section labels */}
      <div className="absolute top-3 inset-x-0 z-20 flex justify-around px-4 pointer-events-none">
        {([
          { label: 'DATABASE',  color: '#f59e0b' },
          { label: 'BACKEND',   color: '#a78bfa' },
          { label: 'FRONTEND',  color: '#38bdf8' },
        ] as const).map(s => (
          <div
            key={s.label}
            style={{
              fontFamily: 'Syne, sans-serif', fontSize: '10px', fontWeight: 700,
              letterSpacing: '0.15em', color: s.color, opacity: 0.75,
              background: `${s.color}12`, border: `1px solid ${s.color}30`,
              padding: '3px 12px', borderRadius: '4px',
            }}
          >
            {s.label}
          </div>
        ))}
      </div>

      {/* Controls hint */}
      <div className="absolute top-12 right-4 z-20 pointer-events-none"
        style={{ fontFamily: 'Fragment Mono, monospace', fontSize: '9px', color: '#2a4060' }}>
        drag · scroll to zoom · click to inspect
      </div>

      {/* Edge legend */}
      <div
        className="absolute bottom-4 left-4 z-20 p-3 rounded-xl"
        style={{ background: 'rgba(7,13,22,0.88)', backdropFilter: 'blur(16px)', border: '1px solid rgba(255,255,255,0.05)' }}
      >
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '9px', fontWeight: 600,
          letterSpacing: '0.12em', color: '#4a6888', marginBottom: '8px' }}>
          RELATIONSHIP TYPES
        </div>
        {([
          { color: '#00e5b8', label: 'MAPS_TO — SQL → Python' },
          { color: '#38bdf8', label: 'SERIALIZES_TO — Python → TS' },
          { color: '#34d399', label: 'RENDERS — TS → React' },
          { color: '#818cf8', label: 'EXPOSES_AS — route API' },
          { color: '#ff5733', label: 'CRITICAL BREAK' },
          { color: '#2a4060', label: 'AST / IMPORT' },
        ] as const).map(e => (
          <div key={e.label} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
            <div style={{ width: '18px', height: '2px', background: e.color, borderRadius: '1px' }} />
            <span style={{ fontFamily: 'Fragment Mono, monospace', fontSize: '9px', color: '#8da4bd' }}>
              {e.label}
            </span>
          </div>
        ))}
      </div>

      {/* Stats badge */}
      <div className="absolute bottom-4 right-4 z-20"
        style={{ fontFamily: 'Fragment Mono, monospace', fontSize: '9px', color: '#4a6888',
          background: 'rgba(7,13,22,0.85)', border: '1px solid rgba(255,255,255,0.05)',
          padding: '4px 10px', borderRadius: '6px' }}>
        {graphData.nodes.length} nodes · {graphData.edges.length} edges
      </div>

      {/* 3D Force Graph */}
      <ForceGraph3D
        ref={fgRef}
        graphData={fg3dData}
        width={dimensions.width}
        height={dimensions.height}
        backgroundColor="#04070d"
        nodeThreeObject={nodeThreeObject}
        nodeThreeObjectExtend={false}
        linkColor={linkColor}
        linkWidth={linkWidth}
        linkOpacity={0.65}
        linkDirectionalArrowLength={3.5}
        linkDirectionalArrowRelPos={1}
        linkDirectionalArrowColor={linkColor}
        linkDirectionalParticles={linkDirectionalParticles}
        linkDirectionalParticleColor={() => '#ff5733'}
        linkDirectionalParticleSpeed={0.005}
        linkDirectionalParticleWidth={1.5}
        onNodeClick={(node: any) => selectNode(node.id)}
        onBackgroundClick={() => selectNode(null)}
        d3AlphaDecay={0.025}
        d3VelocityDecay={0.3}
        cooldownTicks={250}
        showNavInfo={false}
      />
    </div>
  );
};

export default GraphCanvas;
