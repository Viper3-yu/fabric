import { StrictMode, useRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useCinematicMotion } from './motion';

function MotionHarness() {
  const scope = useRef<HTMLDivElement>(null);
  useCinematicMotion(scope);

  return (
    <div ref={scope}>
      <nav data-motion="nav" data-testid="nav" />
      <section data-motion="hero">
        <h1 data-reveal data-testid="hero" />
      </section>
      <section data-motion="bento">
        <article data-bento-card data-testid="card" />
      </section>
    </div>
  );
}

describe('useCinematicMotion', () => {
  it('reduced motion 下不写入透明度或位移样式，且 StrictMode 卸载安全', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: query === '(prefers-reduced-motion: reduce)',
          media: query,
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as MediaQueryList,
    );
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const view = render(
      <StrictMode>
        <MotionHarness />
      </StrictMode>,
    );

    for (const element of [
      screen.getByTestId('nav'),
      screen.getByTestId('hero'),
      screen.getByTestId('card'),
    ]) {
      expect(element.style.opacity).toBe('');
      expect(element.style.transform).toBe('');
    }

    expect(() => view.unmount()).not.toThrow();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
