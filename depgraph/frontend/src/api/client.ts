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
    score: number;    // 0–∞, CRITICAL≥8, HIGH≥4, MEDIUM≥1
    tier: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
    color?: string;
    breakdown?: {
      weighted_dependents: number;
      api_multiplier: number;
      coverage_multiplier: number;
      untested_count: number;
    };
  };
}

export interface ChatResponse {
  answer: string;
}

// ── Auth types ───────────────────────────────────────────────────────────────

export interface LoginResponse {
  token: string;
  username: string;
}

// ── Chat history types ───────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
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

const API_BASE = import.meta.env.VITE_API_BASE_URL
  ? `${import.meta.env.VITE_API_BASE_URL}/api`
  : 'http://localhost:8000/api';

const api: AxiosInstance = axios.create({
  baseURL: API_BASE,
  timeout: 40000, // 40s — accounts for LLM latency
  headers: {
    'Content-Type': 'application/json',
  },
});

// Inject auth token on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('depgraph_token');
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`;
  }
  return config;
});

// Global error interceptor
api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    const url = error.config?.url || '';
    const status = error.response?.status;

    // Auth endpoints (login/register) handle errors inline — don't toast
    const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/register');

    if (status === 401 && !isAuthEndpoint) {
      localStorage.removeItem('depgraph_token');
      window.dispatchEvent(new Event('auth:logout'));
    }

    if (!isAuthEndpoint) {
      const data = error.response?.data as { detail?: string } | undefined;
      const message = data?.detail || error.message || 'An unexpected error occurred';
      toast.error('API Error', { description: message });
    }

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

  async chat(
    question: string,
    contextNodeId?: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
    sessionId?: string,
  ): Promise<ChatResponse> {
    const body: { question: string; selected_node_id?: string; history?: object[]; session_id?: string } = { question };
    if (contextNodeId) body.selected_node_id = contextNodeId;
    if (history?.length) body.history = history.map(m => ({ role: m.role, content: m.content }));
    if (sessionId) body.session_id = sessionId;
    const res = await api.post('/chat', body);
    return res.data;
  },

  // ── Auth ──────────────────────────────────────────────────────────────────

  async login(username: string, password: string): Promise<LoginResponse> {
    const res = await api.post('/auth/login', { username, password });
    return res.data;
  },

  async register(username: string, password: string): Promise<LoginResponse> {
    const res = await api.post('/auth/register', { username, password });
    return res.data;
  },

  async getMe(): Promise<{ username: string }> {
    const res = await api.get('/auth/me');
    return res.data;
  },

  // ── Chat history ──────────────────────────────────────────────────────────

  async createChatSession(): Promise<ChatSession> {
    const res = await api.post('/chat/sessions');
    return res.data;
  },

  async getChatSessions(): Promise<{ sessions: ChatSession[] }> {
    const res = await api.get('/chat/sessions');
    return res.data;
  },

  async getChatSessionMessages(sessionId: string): Promise<{ session_id: string; messages: ChatMessage[] }> {
    const res = await api.get(`/chat/sessions/${sessionId}`);
    return res.data;
  },

  async deleteChatSession(sessionId: string): Promise<void> {
    await api.delete(`/chat/sessions/${sessionId}`);
  },

  async migrate(nodeId: string, newName: string): Promise<{
    summary: string;
    safe_order: string[];
    files: Array<{
      file: string;
      language: string;
      line: number;
      old_code: string;
      new_code: string;
      change_type: string;
    }>;
  }> {
    const res = await api.post('/migrate', { node_id: nodeId, new_name: newName });
    return res.data;
  },

  async migrateApply(files: object[]): Promise<{ applied: number; failed: number; results: Array<{ file: string; status: string; detail?: string; changes?: number }> }> {
    const res = await api.post('/migrate/apply', { files });
    return res.data;
  },

  async migrateDownload(files: object[]): Promise<void> {
    const res = await api.post('/migrate/download', { files }, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'migration.zip';
    a.click();
    URL.revokeObjectURL(url);
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

  async getUserStatus(): Promise<{ has_graph: boolean; repo_path: string; node_count: number; edge_count: number; repo_name: string }> {
    const res = await api.get('/user/status');
    return res.data;
  },

  async getRepoPath(): Promise<{ repo_path: string; exists: boolean }> {
    const res = await api.get('/repo-path');
    return res.data;
  },

  async setRepoPath(repoPath: string): Promise<{ repo_path: string; exists: boolean }> {
    const res = await api.post('/repo-path', { repo_path: repoPath });
    return res.data;
  },
};

export default apiClient;
