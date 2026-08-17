import { StrictMode, useRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRevealMotion } from './motion';

function MotionHarness() {
  const scope = useRef<HTMLDivElement>(null);
  useRevealMotion(scope);

  return (
    <div ref={scope}>
      <section data-motion="hero">
        <h1 data-reveal data-testid="hero" />
      </section>
      <ul>
        <li className="shipment-timeline__item" data-testid="timeline-item" />
      </ul>
    </div>
  );
}

function reducedMotionMatchMedia(query: string) {
  return {
    matches: query === '(prefers-reduced-motion: reduce)',
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } as MediaQueryList;
}

describe('useRevealMotion', () => {
  it('IntersectionObserver 不可用时直接显示全部元素', () => {
    const view = render(
      <StrictMode>
        <MotionHarness />
      </StrictMode>,
    );

    expect(screen.getByTestId('hero')).toHaveClass('is-revealed');
    expect(screen.getByTestId('timeline-item')).toHaveClass('is-revealed');
    expect(() => view.unmount()).not.toThrow();
  });

  it('元素进入视口时一次性标记 is-revealed 并停止观察', () => {
    const instances: Array<{
      callback: IntersectionObserverCallback;
      observe: ReturnType<typeof vi.fn>;
      unobserve: ReturnType<typeof vi.fn>;
      disconnect: ReturnType<typeof vi.fn>;
    }> = [];
    class IntersectionObserverMock {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
      constructor(callback: IntersectionObserverCallback) {
        instances.push({
          callback,
          observe: this.observe,
          unobserve: this.unobserve,
          disconnect: this.disconnect,
        });
      }
    }
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = render(
      <StrictMode>
        <MotionHarness />
      </StrictMode>,
    );

    const hero = screen.getByTestId('hero');
    const timelineItem = screen.getByTestId('timeline-item');
    expect(hero).not.toHaveClass('is-revealed');

    const first = instances.at(-1)!;
    const asEntry = (target: Element, isIntersecting: boolean) =>
      ({ target, isIntersecting }) as unknown as IntersectionObserverEntry;
    first.callback(
      [asEntry(hero, true), asEntry(timelineItem, false)],
      first as unknown as IntersectionObserver,
    );

    expect(hero).toHaveClass('is-revealed');
    expect(timelineItem).not.toHaveClass('is-revealed');
    expect(first.unobserve).toHaveBeenCalledWith(hero);

    expect(() => view.unmount()).not.toThrow();
    expect(consoleError).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('reduced motion 下跳过观察直接显示', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(reducedMotionMatchMedia);
    const observeSpy = vi.fn();
    class IntersectionObserverMock {
      observe = observeSpy;
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock);

    render(
      <StrictMode>
        <MotionHarness />
      </StrictMode>,
    );

    expect(screen.getByTestId('hero')).toHaveClass('is-revealed');
    expect(observeSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
