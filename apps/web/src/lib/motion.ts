import type { DependencyList, RefObject } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(useGSAP, ScrollTrigger);

export function useCinematicMotion(
  scope: RefObject<HTMLElement | null>,
  dependencies: DependencyList = [],
) {
  useGSAP(
    () => {
      if (!scope.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      const heroItems = Array.from(
        scope.current.querySelectorAll<HTMLElement>('[data-motion="hero"] > [data-reveal]'),
      );
      const bentoCards = Array.from(
        scope.current.querySelectorAll<HTMLElement>('[data-motion="bento"] > [data-bento-card]'),
      );
      const routeScenes = Array.from(
        scope.current.querySelectorAll<HTMLElement>('[data-route-scene]'),
      );

      const entrance = gsap.timeline({ defaults: { ease: 'power3.out' } });
      if (heroItems.length) {
        entrance.from(heroItems, {
          y: 16,
          opacity: 0,
          duration: 0.52,
          stagger: 0.06,
          clearProps: 'transform,opacity',
        });
      }
      if (bentoCards.length) {
        entrance.from(
          bentoCards,
          {
            y: 8,
            opacity: 0,
            duration: 0.24,
            stagger: 0,
            clearProps: 'transform,opacity',
          },
          heroItems.length ? '-=0.18' : 0,
        );
      }

      routeScenes.forEach((scene) => {
        const line = scene.querySelector<SVGPathElement>('[data-route-line]');
        const nodes = Array.from(scene.querySelectorAll<HTMLElement>('[data-route-node]'));
        if (line) {
          gsap.fromTo(
            line,
            { strokeDashoffset: 1 },
            {
              strokeDashoffset: 0,
              duration: 0.88,
              ease: 'power2.out',
              clearProps: 'strokeDashoffset',
            },
          );
        }
        if (nodes.length) {
          gsap.from(nodes, {
            opacity: 0,
            scale: 0.75,
            duration: 0.18,
            stagger: 0.07,
            delay: line ? 0.28 : 0,
            ease: 'power2.out',
            clearProps: 'transform,opacity',
          });
        }
      });

      const media = gsap.matchMedia();
      media.add('(prefers-reduced-motion: no-preference)', () => {
        const imageReveals = gsap.utils.toArray<HTMLElement>(
          '[data-motion-image]',
          scope.current ?? undefined,
        );
        const copyReveals = gsap.utils.toArray<HTMLElement>(
          '[data-scrub-copy]',
          scope.current ?? undefined,
        );

        imageReveals.forEach((image) => {
          gsap.fromTo(
            image,
            { scale: 0.97, opacity: 0.82 },
            {
              scale: 1,
              opacity: 1,
              ease: 'power1.out',
              scrollTrigger: {
                trigger: image,
                start: 'top 86%',
                end: 'top 58%',
                scrub: 0.45,
              },
            },
          );
        });

        copyReveals.forEach((copy) => {
          gsap.fromTo(
            copy,
            { y: 10, opacity: 0.42 },
            {
              y: 0,
              opacity: 1,
              ease: 'none',
              scrollTrigger: {
                trigger: copy,
                start: 'top 88%',
                end: 'top 64%',
                scrub: 0.4,
              },
            },
          );
        });
      });

      return () => media.revert();
    },
    { scope, dependencies: [...dependencies], revertOnUpdate: true },
  );
}
