import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../auth/AuthContext';
import { LoginPage } from './LoginPage';

describe('登录页', () => {
  it('展示演示账户并将 JWT 会话持久化', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          token: 'demo-token',
          ledgerMode: 'demo',
          user: {
            id: 'carrier-1',
            username: 'carrier',
            displayName: '华东承运中心',
            role: 'carrier',
            mspId: 'Org2MSP',
          },
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
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

    expect(screen.getByText('演示账户')).toBeInTheDocument();
    expect(screen.getByText('carrier123')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '使用承运方账户' }));
    expect(screen.getByLabelText('用户名')).toHaveValue('carrier');
    expect(screen.getByLabelText('密码')).toHaveValue('carrier123');

    await user.click(screen.getByRole('button', { name: '进入工作台' }));

    expect(await screen.findByText('工作台已打开')).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/auth/login',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(window.localStorage.getItem('jixin.auth.session')).toContain('demo-token');
  });
});
