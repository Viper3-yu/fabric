import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

function BrokenPage(): never {
  throw new Error('Failed to fetch dynamically imported module: /assets/LoginPage-old.js');
}

describe('ErrorBoundary recovery', () => {
  afterEach(() => vi.restoreAllMocks());

  it('offers document navigation outside the failed React lazy tree', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><BrokenPage /></ErrorBoundary>);
    expect(screen.getByRole('button', { name: '重新加载页面' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '返回物流查询' })).toHaveAttribute('href', '/track');
    expect(screen.getByText(/本机服务暂时离线/)).toBeInTheDocument();
  });
});
