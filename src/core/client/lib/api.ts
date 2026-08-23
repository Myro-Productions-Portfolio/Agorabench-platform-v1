import type { ApiResponse } from '@shared/types';

const API_BASE = '/api';

// Clerk token provider — set once on app mount via setTokenProvider()
let _tokenProvider: (() => Promise<string | null>) | null = null;

export function setTokenProvider(fn: () => Promise<string | null>): void {
  _tokenProvider = fn;
}

async function getTokenWithTimeout(ms = 2000): Promise<string | null> {
  if (!_tokenProvider) return null;
  try {
    const result = await Promise.race([
      _tokenProvider(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
    ]);
    return result;
  } catch {
    return null;
  }
}

async function request<T>(
  endpoint: string,
  options?: RequestInit,
): Promise<ApiResponse<T>> {
  const url = `${API_BASE}${endpoint}`;

  const token = await getTokenWithTimeout();

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
    ...options,
  });

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Expected JSON but got ${contentType || 'unknown content-type'} (status ${response.status})`);
  }

  const data: ApiResponse<T> = await response.json();

  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }

  return data;
}

/* Agent endpoints */
export const agentsApi = {
  list: (page = 1, limit = 20) =>
    request(`/agents?page=${page}&limit=${limit}`),
  directory: () =>
    request('/agents/directory'),
  getById: (id: string) =>
    request(`/agents/${id}`),
  register: (data: { agoraId: string; name: string; displayName: string; bio?: string }) =>
    request('/agents/register', { method: 'POST', body: JSON.stringify(data) }),
  getProfile: (id: string) =>
    request(`/agents/${id}/profile`),
  finances: (id: string, limit = 50, offset = 0) =>
    request(`/agents/${id}/finances?limit=${limit}&offset=${offset}`),
  relationshipsSummary: () =>
    request('/agents/relationships/summary'),
  customize: (id: string, avatarConfig: string) =>
    request(`/agents/${id}/customize`, { method: 'PUT', body: JSON.stringify({ avatarConfig }) }),
  coalitions: () =>
    request('/agents/coalitions'),
};

/* Campaign endpoints */
export const campaignsApi = {
  active: (page = 1, limit = 20) =>
    request(`/campaigns/active?page=${page}&limit=${limit}`),
  announce: (data: { agentId: string; electionId: string; platform: string }) =>
    request('/campaigns/announce', { method: 'POST', body: JSON.stringify(data) }),
};

/* Legislation endpoints */
export const legislationApi = {
  active: (page = 1, limit = 20) =>
    request(`/legislation/active?page=${page}&limit=${limit}`),
  list: (page = 1, limit = 20) =>
    request(`/legislation?page=${page}&limit=${limit}`),
  getById: (id: string) =>
    request(`/legislation/${id}`),
  propose: (data: {
    title: string;
    summary: string;
    fullText: string;
    sponsorId: string;
    coSponsorIds?: string[];
    committee: string;
  }) =>
    request('/legislation/propose', { method: 'POST', body: JSON.stringify(data) }),
  vote: (data: { billId: string; voterId: string; choice: 'yea' | 'nay' | 'abstain' }) =>
    request('/legislation/vote', { method: 'POST', body: JSON.stringify(data) }),
  laws: () => request('/laws'),
  lawById: (id: string) => request(`/laws/${id}`),
};

/* Press endpoints */
export const pressApi = {
  gazette: (limit = 20, offset = 0) =>
    request(`/press/gazette?limit=${limit}&offset=${offset}`),
  gazetteLatest: () =>
    request('/press/gazette/latest'),
  reports: (limit = 20, offset = 0) =>
    request(`/press/reports?limit=${limit}&offset=${offset}`),
};

/* Capitol City spectator endpoints (city-effect-layer slice 3) */
export const cityApi = {
  state: () =>
    request('/city/state'),
  history: (limit = 96) =>
    request(`/city/history?limit=${limit}`),
};

/* Vote endpoints */
export const votesApi = {
  cast: (data: {
    voterId: string;
    electionId?: string;
    billId?: string;
    candidateId?: string;
    choice: string;
  }) =>
    request('/votes/cast', { method: 'POST', body: JSON.stringify(data) }),
};

/* Government endpoints */
export const governmentApi = {
  officials: () =>
    request('/government/officials'),
  overview: () =>
    request('/government/overview'),
  budget: () =>
    request('/government/budget'),
};

/* Divergence experiment endpoints */
export const divergenceApi = {
  get: () =>
    request('/divergence'),
  scoreboard: () =>
    request('/divergence/scoreboard'),
};

/* Exogenous world-events feed endpoints (E2 slice 1) + state-summary aggregate */
export const worldApi = {
  events: (page = 1, limit = 25, state?: string) =>
    request(`/world/events?page=${page}&limit=${limit}${state ? `&state=${state}` : ''}`),
  stateSummary: (category: string) =>
    request(`/world/state-summary?category=${category}`),
};

/* Party endpoints */
export const partiesApi = {
  list: (page = 1, limit = 20) =>
    request(`/parties/list?page=${page}&limit=${limit}`),
  getById: (id: string) =>
    request(`/parties/${id}`),
  create: (data: {
    name: string;
    abbreviation: string;
    description: string;
    founderId: string;
    alignment: string;
    platform: string;
  }) =>
    request('/parties/create', { method: 'POST', body: JSON.stringify(data) }),
};

/* Elections endpoints */
export const electionsApi = {
  active: () => request('/elections/active'),
  past: () => request('/elections/past'),
  getById: (id: string) => request(`/elections/${id}`),
  electoral: (id: string) => request(`/elections/${id}/electoral`),
};

/* Activity endpoints */
export const activityApi = {
  recent: (opts?: { since?: number; limit?: number }) => {
    const params = new URLSearchParams();
    params.set('limit', String(opts?.limit ?? 100));
    if (opts?.since) params.set('since', String(opts.since));
    return request(`/activity?${params.toString()}`);
  },
  forAgent: (agentId: string, limit = 20) =>
    request(`/activity?agentId=${agentId}&limit=${limit}`),
  forType: (type: string, limit = 20) =>
    request(`/activity?type=${encodeURIComponent(type)}&limit=${limit}`),
};

/* Search endpoint */
export const searchApi = {
  global: (q: string, types?: string) => {
    const params = new URLSearchParams({ q });
    if (types) params.set('types', types);
    return request(`/search?${params.toString()}`);
  },
};

/* Calendar endpoints */
export const calendarApi = {
  upcoming: () => request('/calendar'),
  events: (view?: 'upcoming' | 'past') =>
    request(`/calendar/events${view ? `?view=${view}` : ''}`),
  getEvent: (id: string) => request(`/calendar/events/${id}`),
};

export const forumApi = {
  threads: (category?: string) =>
    request(`/forum/threads${category && category !== 'all' ? `?category=${category}` : ''}`),
  thread: (id: string) => request(`/forum/threads/${id}`),
  posts: (threadId: string) => request(`/forum/threads/${threadId}/posts`),
  latest: () => request('/forum/latest'),
};

/* Health check */
export const healthApi = {
  check: () => request('/health'),
  ticks: (limit = 20) => request(`/admin/health/ticks?limit=${limit}`),
  latency: (limit = 100) => request(`/admin/health/latency?limit=${limit}`),
  errors: (hours = 24) => request(`/admin/health/errors?hours=${hours}`),
};

/* Admin endpoints */
export const adminApi = {
  status: () => request('/admin/status'),
  pause: () => request('/admin/pause', { method: 'POST' }),
  resume: () => request('/admin/resume', { method: 'POST' }),
  tick: () => request('/admin/tick', { method: 'POST' }),
  reseed: () => request('/admin/reseed', { method: 'POST' }),
  decisions: (page = 1, limit = 50) =>
    request(`/admin/decisions?page=${page}&limit=${limit}`),
  getConfig: () => request('/admin/config'),
  setConfig: (data: Record<string, unknown>) =>
    request('/admin/config', { method: 'POST', body: JSON.stringify(data) }),
  getInferencePresets: () => request('/admin/inference-presets'),
  getAgents: () => request('/admin/agents'),
  toggleAgent: (id: string) =>
    request(`/admin/agents/${id}/toggle`, { method: 'POST' }),
  getEconomy: () => request('/admin/economy'),
  setEconomy: (data: { treasuryBalance?: number; taxRatePercent?: number }) =>
    request('/admin/economy', { method: 'POST', body: JSON.stringify(data) }),
  createAgent: (data: Record<string, unknown>) =>
    request('/admin/agents/create', { method: 'POST', body: JSON.stringify(data) }),
  getUsers: () => request('/admin/users'),
  setUserRole: (id: string, role: 'researcher' | 'user') =>
    request(`/admin/users/${id}/role`, { method: 'POST', body: JSON.stringify({ role }) }),
  getResearcherRequests: (status?: string) =>
    request(`/admin/researcher-requests${status ? `?status=${status}` : ''}`),
  approveResearcherRequest: (id: string) =>
    request(`/admin/researcher-requests/${id}/approve`, { method: 'POST' }),
  rejectResearcherRequest: (id: string) =>
    request(`/admin/researcher-requests/${id}/reject`, { method: 'POST' }),
  exportCounts: () => request('/admin/export/counts'),
  getModels: (url?: string) => request(`/admin/models${url ? `?url=${encodeURIComponent(url)}` : ''}`),
  getActiveElections: () => request('/admin/elections/active'),
  triggerElection: (positionType: string) =>
    request('/admin/elections/trigger', { method: 'POST', body: JSON.stringify({ positionType }) }),
  advanceElection: (id: string) =>
    request(`/admin/elections/${id}/advance`, { method: 'POST' }),
  godMode: () => request('/admin/god/mode'),
  godTick: () => request('/admin/god/tick', { method: 'POST' }),
  godInterventions: () => request('/admin/god/interventions'),
  godBobPing: () => request('/admin/god/bob-ping', { method: 'POST' }),
  downloadExport: async (dataset: string, filename: string): Promise<void> => {
    const token = _tokenProvider ? await _tokenProvider() : null;
    const res = await fetch(`/api/admin/export/${dataset}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Export failed: ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
};

export const profileApi = {
  me: () => request('/profile/me'),
  getAgents: () => request('/profile/agents'),
  createAgent: (data: Record<string, unknown>) =>
    request('/profile/agents/create', { method: 'POST', body: JSON.stringify(data) }),
  getApiKeys: () => request('/profile/apikeys'),
  setApiKey: (provider: string, data: { key: string; model?: string }) =>
    request(`/profile/apikeys/${provider}`, { method: 'POST', body: JSON.stringify(data) }),
  deleteApiKey: (provider: string) =>
    request(`/profile/apikeys/${provider}`, { method: 'DELETE' }),
  getResearcherRequest: () => request('/profile/researcher-request'),
  submitResearcherRequest: (message: string) =>
    request('/profile/researcher-request', { method: 'POST', body: JSON.stringify({ message }) }),
};

/* Court endpoints (Phase 4 case-centric docket + legacy archive) */
export interface CourtCasesQuery {
  status?: string;
  q?: string;
  outcome?: string;
  caseType?: string;
  limit?: number;
  offset?: number;
}

export const courtApi = {
  stats: () => request('/court/stats'),
  /* Accepts either a bare status string (docket back-compat) or an options
     object (records view — search + filters + server-side pagination). */
  cases: (opts?: string | CourtCasesQuery) => {
    const o: CourtCasesQuery = typeof opts === 'string' ? { status: opts } : (opts ?? {});
    const params = new URLSearchParams();
    if (o.status) params.set('status', o.status);
    if (o.q) params.set('q', o.q);
    if (o.outcome) params.set('outcome', o.outcome);
    if (o.caseType) params.set('caseType', o.caseType);
    if (o.limit !== undefined) params.set('limit', String(o.limit));
    if (o.offset !== undefined) params.set('offset', String(o.offset));
    const qs = params.toString();
    return request(`/court/cases${qs ? `?${qs}` : ''}`);
  },
  caseById: (id: string) => request(`/court/cases/${id}`),
  archive: () => request('/court/archive'),
};

export const providersApi = {
  list: () => request('/admin/providers'),
  set: (name: string, data: { key?: string; isActive?: boolean; ollamaBaseUrl?: string; defaultModel?: string }) =>
    request(`/admin/providers/${name}`, { method: 'POST', body: JSON.stringify(data) }),
  test: (name: string) =>
    request(`/admin/providers/${name}/test`, { method: 'POST' }),
  clear: (name: string) =>
    request(`/admin/providers/${name}`, { method: 'DELETE' }),
};

/* Decision endpoints (public) */
export const decisionsApi = {
  list: (params?: { limit?: number; agentId?: string; phase?: string; tickId?: string }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.agentId) qs.set('agentId', params.agentId);
    if (params?.phase) qs.set('phase', params.phase);
    if (params?.tickId) qs.set('tickId', params.tickId);
    return request(`/decisions?${qs.toString()}`);
  },
};

/* Tick endpoints (public) */
export const ticksApi = {
  recent: (limit = 5) => request(`/ticks?limit=${limit}`),
  summary: (tickId: string) => request(`/ticks/${tickId}/summary`),
};

/* Researcher dashboard endpoints */
export const researcherApi = {
  dashboard: () => request('/researcher/dashboard'),
  agents: () => request('/researcher/agents'),
  agentPerformance: (agentId: string) =>
    request(`/researcher/agents/${agentId}/performance`),
  withdrawAgent: (agentId: string) =>
    request(`/researcher/agents/${agentId}/withdraw`, { method: 'POST' }),
};
