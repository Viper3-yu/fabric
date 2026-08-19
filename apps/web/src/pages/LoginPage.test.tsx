import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { LoginPage } from './LoginPage';

const loginPayload = {
  success: true,
  data: {
    token: 'session-token',
    ledgerMode: 'fabric',
    user: {
      id: 'carrier-1',
      username: 'carrier',
      displayName: '华东承运中心',
      role: 'carrier',
      mspId: 'Org2MSP',
    },
  },
};

function fetchMock() {
  return vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
    // Boot-time session restore: no cookie yet, so /auth/me answers 401.
    if (url === '/api/auth/me') {
      return {
        ok: false,
        status: 401,
        json: async () => ({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'expired', requestId: 'test' },
        }),
      };
    }
    if (url === '/api/auth/logout') {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, data: { loggedOut: true } }),
      };
    }
    if (url === '/api/network') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: {
            mode: 'fabric',
            health: { mode: 'fabric', status: 'ok', network: 'hyperledger-fabric' },
          },
        }),
      };
    }
    if (url === '/api/auth/login') {
      expect(init?.credentials).toBe('include');
      return { ok: true, status: 200, json: async () => loginPayload };
    }
    throw new Error('unexpected request: ' + url);
  });
}

describe('登录页', () => {
  it('输入业务账户并通过 httpOnly cookie 会话进入工作台', async () => {
    const mock = fetchMock();
    vi.stubGlobal('fetch', mock);
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/login']}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/app" element={<div>工作台已打开</div>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    // 表单初始为空，页面上没有任何预置凭据。
    expect(screen.getByLabelText('用户名')).toHaveValue('');
    expect(screen.getByLabelText('密码')).toHaveValue('');
    expect(screen.queryByText('演示账户')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('用户名'), 'carrier');
    await user.type(screen.getByLabelText('密码'), 'carrier-secret');
    await user.click(screen.getByRole('button', { name: '进入工作台' }));

    expect(await screen.findByText('工作台已打开')).toBeInTheDocument();
    await waitFor(() => {
      expect(mock).toHaveBeenCalledWith(
        '/api/auth/login',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
          body: JSON.stringify({ username: 'carrier', password: 'carrier-secret' }),
        }),
      );
    });
    // The token must never reach localStorage: the session rides the cookie.
    expect(window.localStorage.getItem('jixin.auth.session')).toBeNull();
  });
});
