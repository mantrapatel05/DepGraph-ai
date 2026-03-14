import axios, { AxiosInstance, AxiosError } from 'axios';
import { toast } from 'sonner';

export interface GraphNode {
  id: string;
  type: string;
  name: string;
  language: string;
  file: string;
  line_start: number;
  line_end: number;
  summary: string;
  domain?: string;
  severity?: {
    score: number;
    tier: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    color: string;
    breakdown?: Record<string, number>;
  };
  // metadata fields flattened at top level after AppContext transforms the response
  sensitivity?: string;
  boundary_signals?: string[];
  is_boundary?: boolean;
  data_in?: string[];
  data_out?: string[];
  transformations?: string[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  data: {
    type: string;
    confidence: number;
    inferred_by: string;
    transformation: string;
    data_fields: string[];
    break_risk: string;
    break_reason: string;
  };
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface ImpactChainNode {
  node: {
    id: string;
    name: string;
    type: string;
    language: string;
    file: string;
    line_start: number;
    line_end: number;
    summary?: string;
  };
  distance: number;
  path: string[];
  path_confidence: number;
  max_break_risk: string;
}

export interface ImpactResult {
  source: Record<string, any>;
  affected_count: number;
  languages_affected: string[];
  has_critical_breaks: boolean;
  chain: ImpactChainNode[];
  severity: {
    score: number;
    tier: string;
    color?: string;
    breakdown?: Record<string, number>;
  };
}

export interface ChatResponse {
  answer: string;
}

// ── Knowledge Graph enrichment types ────────────────────────────────────────

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

export interface VariableChain {
  name: string;
  steps: ChainStep[];
}

export interface ChainsResponse {
  chains: VariableChain[];
  count: number;
}

export interface RouteNode {
  node_id: string;
  name: string;
  file: string;
  line_start: number;
  summary: string;
  data_in: string[];
  data_out: string[];
  response_types: { id: string; name: string; file: string }[];
  sensitivity: string;
}

export interface RoutesResponse {
  routes: RouteNode[];
  count: number;
}

export interface SectionsResponse {
  sections: { DATABASE: number; BACKEND: number; FRONTEND: number };
  cross_section_edges: number;
  total_nodes: number;
  total_edges: number;
}

const API_BASE = 'http://localhost:8000/api';

const api: AxiosInstance = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Global error interceptor
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const data = error.response?.data as { detail?: string } | undefined;
    const message = data?.detail || error.message || 'An unexpected error occurred';
    toast.error('API Error', {
      description: message,
    });
    return Promise.reject(error);
  }
);

export const apiClient = {
  async analyzeRepo(repoPath: string): Promise<{ success: boolean; message: string }> {
    const res = await api.post(`/analyze?repo_path=${encodeURIComponent(repoPath)}`);
    return res.data;
  },

  async getGraph(): Promise<GraphData> {
    const res = await api.get('/graph');
    return res.data;
  },

  async getImpact(nodeId: string): Promise<ImpactResult> {
    const res = await api.get(`/impact/${encodeURIComponent(nodeId)}`);
    return res.data;
  },

  async chat(question: string, contextNodeId?: string): Promise<ChatResponse> {
    const body: { question: string; selected_node_id?: string } = { question };
    if (contextNodeId) body.selected_node_id = contextNodeId;
    
    const res = await api.post('/chat', body);
    return res.data;
  },

  async migrate(nodeId: string, newName: string): Promise<{ success: boolean; plan: string[] }> {
    const res = await api.post('/migrate', { node_id: nodeId, new_name: newName });
    return res.data;
  },

  async getChains(): Promise<ChainsResponse> {
    const res = await api.get('/chains');
    return res.data;
  },

  async getRoutes(): Promise<RoutesResponse> {
    const res = await api.get('/routes');
    return res.data;
  },

  async getSections(): Promise<SectionsResponse> {
    const res = await api.get('/sections');
    return res.data;
  },
};

export default apiClient;
