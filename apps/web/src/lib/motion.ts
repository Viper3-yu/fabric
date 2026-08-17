import { useEffect, type DependencyList, type RefObject } from 'react';

const REVEAL_SELECTOR = '[data-reveal], .shipment-timeline__item';

/**
 * 按 DESIGN.md 动效阶梯只做一次性进出场：元素进入视口时加上
 * `.is-revealed`，由 CSS 完成淡入上移。滚动钉住、逐词 scrub、
 * 无限跑马等已在设计宪法禁止事项中移除，不在本 hook 职责内。
 */
export function useRevealMotion(
  scope: RefObject<HTMLElement | null>,
  dependencies: DependencyList = [],
) {
  useEffect(() => {
    const root = scope.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>(REVEAL_SELECTOR));
    if (targets.length === 0) return;

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || typeof IntersectionObserver === 'undefined') {
      for (const element of targets) element.classList.add('is-revealed');
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-revealed');
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.05 },
    );
    for (const element of targets) observer.observe(element);
    return () => observer.disconnect();
    // dependencies 由调用方按数据变化驱动重新扫描目标元素。
  }, [scope, ...dependencies]);
}
