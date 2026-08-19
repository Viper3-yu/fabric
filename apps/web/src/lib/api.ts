import type {
  AppUser,
  DashboardSummary,
  IntegrityResult,
  Shipment,
  ShipmentHistoryEntry,
} from '@jixin/shared';
import type {
  ApiEnvelope,
  CreateShipmentInput,
  LoginResult,
  NetworkInfo,
  ShipmentAction,
  ShipmentActionPayload,
  ShipmentFilters,
  ShipmentListResult,
  ShipmentReceipt,
} from '../types';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

interface ErrorPayload {
  success?: false;
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
}

interface SuccessPayload<T> {
  success: true;
  data: T;
  meta?: ApiEnvelope<T>['meta'];
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId?: string;

  constructor(message: string, code: string, status: number, requestId?: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    if (requestId) this.requestId = requestId;
  }
}

function toMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return '请求未完成，请稍后重试';
}

export function getErrorMessage(error: unknown): string {
  return toMessage(error);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<ApiEnvelope<T>> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body) headers.set('Content-Type', 'application/json');

  let response: Response;
  try {
    // The session JWT travels in the httpOnly cookie set by /api/auth/login;
    // credentials: 'include' sends it on same-origin and cross-origin calls.
    response = await fetch(`${API_BASE}${path}`, { ...init, headers, credentials: 'include' });
  } catch (caught) {
    // A caller aborting its own request is normal (fast navigation/filter
    // changes); surface the AbortError instead of a misleading network error.
    if (caught instanceof DOMException && caught.name === 'AbortError') throw caught;
    throw new ApiError('无法连接服务端，请确认 API 已启动', 'NETWORK_ERROR', 0);
  }

  const payload = (await response.json().catch(() => null)) as
    SuccessPayload<T> | ErrorPayload | null;

  if (!response.ok || !payload || payload.success !== true) {
    const failure = payload as ErrorPayload | null;
    const message = failure?.error?.message ?? `请求失败，状态码 ${response.status}`;
    const error = new ApiError(
      message,
      failure?.error?.code ?? 'REQUEST_FAILED',
      response.status,
      failure?.error?.requestId,
    );
    // A 401 on any protected call means the session cookie expired or was
    // revoked; login itself 401s on bad credentials and public endpoints
    // never require auth, so those two are excluded.
    if (
      response.status === 401 &&
      !path.startsWith('/auth/login') &&
      !path.startsWith('/public/')
    ) {
      window.dispatchEvent(new Event('jixin:unauthorized'));
    }
    throw error;
  }

  const result: ApiEnvelope<T> = { data: payload.data };
  if (payload.meta) result.meta = payload.meta;
  return result;
}

function withSignal(signal: AbortSignal | undefined, init: RequestInit = {}): RequestInit {
  return signal ? { ...init, signal } : init;
}

function buildQuery(filters: ShipmentFilters): string {
  const query = new URLSearchParams();
  if (filters.search) query.set('search', filters.search);
  if (filters.status) query.set('status', filters.status);
  if (filters.limit !== undefined) query.set('limit', String(filters.limit));
  if (filters.offset !== undefined) query.set('offset', String(filters.offset));
  const value = query.toString();
  return value ? `?${value}` : '';
}

export const api = {
  auth: {
    login: (username: string, password: string) =>
      request<LoginResult>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    logout: () => request<{ loggedOut: boolean }>('/auth/logout', { method: 'POST' }),
    me: (signal?: AbortSignal) =>
      request<AppUser | { user: AppUser; ledgerMode?: 'fabric' }>('/auth/me', withSignal(signal)),
  },
  dashboard: {
    summary: (signal?: AbortSignal) =>
      request<DashboardSummary>('/dashboard/summary', withSignal(signal)),
  },
  network: {
    info: (signal?: AbortSignal) => request<NetworkInfo>('/network', withSignal(signal)),
  },
  shipments: {
    list: (filters: ShipmentFilters = {}, signal?: AbortSignal) =>
      request<ShipmentListResult>(`/shipments${buildQuery(filters)}`, withSignal(signal)),
    create: (input: CreateShipmentInput) =>
      request<ShipmentReceipt>('/shipments', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    get: (id: string, signal?: AbortSignal) =>
      request<Shipment>(`/shipments/${encodeURIComponent(id)}`, withSignal(signal)),
    history: (id: string, signal?: AbortSignal) =>
      request<ShipmentHistoryEntry[]>(
        `/shipments/${encodeURIComponent(id)}/history`,
        withSignal(signal),
      ),
    action: (id: string, action: ShipmentAction, payload: ShipmentActionPayload) =>
      request<ShipmentReceipt>(`/shipments/${encodeURIComponent(id)}/actions/${action}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
  },
  public: {
    track: (trackingNumber: string, signal?: AbortSignal) =>
      request<Shipment>(`/public/track/${encodeURIComponent(trackingNumber)}`, withSignal(signal)),
    history: (trackingNumber: string, signal?: AbortSignal) =>
      request<ShipmentHistoryEntry[]>(
        `/public/track/${encodeURIComponent(trackingNumber)}/history`,
        withSignal(signal),
      ),
    verify: (trackingNumber: string, evidenceHash?: string, signal?: AbortSignal) => {
      const body: { trackingNumber: string; evidenceHash?: string } = { trackingNumber };
      if (evidenceHash) body.evidenceHash = evidenceHash;
      return request<IntegrityResult>(
        '/public/verify',
        withSignal(signal, { method: 'POST', body: JSON.stringify(body) }),
      );
    },
  },
};
