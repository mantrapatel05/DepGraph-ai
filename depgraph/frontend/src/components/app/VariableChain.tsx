import React, { useState } from 'react';
import { useApp } from '@/context/AppContext';

// ─── Types (match /api/chains response) ──────────────────────────────────────

export interface ChainStep {
  layer: 'database' | 'backend' | 'frontend';
  node_id: string;
  name: string;
  file: string;
  type: string;
  line_start: number;
  relationship?: string;
  transformation?: string;
}

export interface VariableChainData {
  name: string;
  steps: ChainStep[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LAYER_STYLE: Record<string, { color: string; label: string; bg: string }> = {
  database: { color: '#f59e0b', label: 'DATABASE', bg: 'rgba(245,158,11,0.08)' },
  backend:  { color: '#a78bfa', label: 'BACKEND',  bg: 'rgba(167,139,250,0.08)' },
  frontend: { color: '#38bdf8', label: 'FRONTEND', bg: 'rgba(56,189,248,0.08)' },
};

const REL_COLORS: Record<string, string> = {
  MAPS_TO:       '#00e5b8',
  SERIALIZES_TO: '#38bdf8',
  RENDERS:       '#34d399',
  EXPOSES_AS:    '#818cf8',
  FLOWS_TO:      '#7c3aed',
};

const TRANSFORM_LABELS: Record<string, string> = {
  snake_to_camel: 'snake → camelCase',
  camel_to_snake: 'camelCase → snake',
  direct:         'direct',
  rename:         'renamed',
};

// ─── Single chain card ────────────────────────────────────────────────────────

function ChainCard({
  chain,
  isActive,
  onSelect,
}: {
  chain: VariableChainData;
  isActive: boolean;
  onSelect: () => void;
}) {
  const { selectNode } = useApp();

  return (
    <div
      onClick={onSelect}
      style={{
        border: `1px solid ${isActive ? '#00e5b8' : 'rgba(255,255,255,0.05)'}`,
        borderRadius: '10px',
        padding: '12px',
        marginBottom: '8px',
        cursor: 'pointer',
        background: isActive ? 'rgba(0,229,184,0.04)' : 'rgba(12,21,32,0.6)',
        transition: 'border 0.15s, background 0.15s',
      }}
    >
      {/* Chain name */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <span style={{
          fontFamily: 'Fragment Mono, monospace', fontSize: '12px', fontWeight: 500,
          color: isActive ? '#00e5b8' : '#e8f0fa',
        }}>
          {chain.name}
        </span>
        <span style={{
          fontFamily: 'Fragment Mono, monospace', fontSize: '8px', color: '#4a6888',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)',
          padding: '2px 6px', borderRadius: '3px',
        }}>
          {chain.steps.length} layers
        </span>
      </div>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
        {chain.steps.map((step, idx) => {
          const ls = LAYER_STYLE[step.layer] || LAYER_STYLE.backend;
          const relColor = REL_COLORS[step.relationship || ''] || '#2a4060';
          const transformLabel = TRANSFORM_LABELS[step.transformation || ''] || step.transformation || '';

          return (
            <React.Fragment key={step.node_id || idx}>
              {/* Connector arrow + relation label */}
              {idx > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', padding: '3px 0 3px 12px' }}>
                  <div style={{ width: '1px', height: '16px', background: relColor, marginRight: '8px' }} />
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    {step.relationship && (
                      <span style={{
                        fontFamily: 'Fragment Mono, monospace', fontSize: '8px',
                        color: relColor, background: `${relColor}14`,
                        border: `1px solid ${relColor}30`, padding: '1px 5px', borderRadius: '3px',
                      }}>
                        {step.relationship}
                      </span>
                    )}
                    {transformLabel && (
                      <span style={{
                        fontFamily: 'Fragment Mono, monospace', fontSize: '8px', color: '#4a6888',
                      }}>
                        {transformLabel}
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Step node */}
              <div
                onClick={(e) => { e.stopPropagation(); if (step.node_id) selectNode(step.node_id); }}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: '8px',
                  padding: '6px 8px', borderRadius: '6px',
                  background: isActive ? ls.bg : 'transparent',
                  border: `1px solid ${isActive ? `${ls.color}30` : 'transparent'}`,
                  cursor: step.node_id ? 'pointer' : 'default',
                  transition: 'background 0.1s',
                }}
              >
                {/* Layer badge */}
                <span style={{
                  fontFamily: 'Syne, sans-serif', fontSize: '7px', fontWeight: 700,
                  letterSpacing: '0.1em', color: ls.color, background: `${ls.color}18`,
                  border: `1px solid ${ls.color}35`, padding: '2px 5px',
                  borderRadius: '3px', whiteSpace: 'nowrap', marginTop: '1px',
                }}>
                  {ls.label}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'Fragment Mono, monospace', fontSize: '11px',
                    color: '#c8d8e8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {step.name}
                  </div>
                  <div style={{
                    fontFamily: 'Fragment Mono, monospace', fontSize: '8px', color: '#4a6888', marginTop: '1px',
                  }}>
                    [{step.type}] {step.file?.split('/').pop()}
                    {step.line_start ? ` :${step.line_start}` : ''}
                  </div>
                </div>
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

// ─── VariableChain panel ──────────────────────────────────────────────────────

interface VariableChainProps {
  chains: VariableChainData[];
  loading?: boolean;
}

const VariableChain: React.FC<VariableChainProps> = ({ chains, loading }) => {
  const [activeChain, setActiveChain] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const filtered = chains.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.steps.some(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  if (loading) {
    return (
      <div style={{ padding: '20px', fontFamily: 'Fragment Mono, monospace', fontSize: '12px', color: '#4a6888' }}>
        Detecting variable chains…
      </div>
    );
  }

  if (!chains.length) {
    return (
      <div style={{ padding: '20px', fontFamily: 'Fragment Mono, monospace', fontSize: '12px',
        color: '#4a6888', textAlign: 'center', lineHeight: '1.8' }}>
        No chains detected yet.<br />
        <span style={{ color: '#2a4060', fontSize: '10px' }}>Run analysis to find DB → Backend → Frontend variable mappings.</span>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
        <div style={{ fontFamily: 'Syne, sans-serif', fontSize: '10px', fontWeight: 600,
          letterSpacing: '0.12em', color: '#4a6888', marginBottom: '8px' }}>
          VARIABLE CHAINS
        </div>
        <div style={{ display: 'flex', gap: '6px', fontSize: '9px', fontFamily: 'Fragment Mono, monospace',
          color: '#4a6888', marginBottom: '10px' }}>
          <span style={{ color: '#f59e0b' }}>■</span> DATABASE
          <span style={{ marginLeft: '4px', color: '#a78bfa' }}>■</span> BACKEND
          <span style={{ marginLeft: '4px', color: '#38bdf8' }}>■</span> FRONTEND
        </div>
        {/* Search */}
        <input
          type="text"
          placeholder="search chains…"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{
            width: '100%', padding: '5px 8px',
            fontFamily: 'Fragment Mono, monospace', fontSize: '10px',
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: '6px', color: '#c8d8e8', outline: 'none',
          }}
        />
        <div style={{ marginTop: '6px', fontFamily: 'Fragment Mono, monospace', fontSize: '9px', color: '#2a4060' }}>
          {filtered.length} chain{filtered.length !== 1 ? 's' : ''} found
        </div>
      </div>

      {/* Chain list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
        {filtered.map(chain => (
          <ChainCard
            key={chain.name}
            chain={chain}
            isActive={activeChain === chain.name}
            onSelect={() => setActiveChain(prev => prev === chain.name ? null : chain.name)}
          />
        ))}
      </div>
    </div>
  );
};

export default VariableChain;
