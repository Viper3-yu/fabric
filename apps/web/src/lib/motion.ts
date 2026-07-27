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
      const timelineItems = Array.from(
        scope.current.querySelectorAll<HTMLElement>('.shipment-timeline__item'),
      );

      const entrance = gsap.timeline({ defaults: { ease: 'power3.out' } });
      if (heroItems.length) {
        entrance.from(heroItems, {
          y: 44,
          opacity: 0,
          duration: 0.84,
          stagger: 0.1,
          clearProps: 'transform,opacity',
        });
      }
      if (bentoCards.length) {
        entrance.from(
          bentoCards,
          {
            y: 30,
            opacity: 0,
            duration: 0.54,
            stagger: 0.08,
            clearProps: 'transform,opacity',
          },
          heroItems.length ? '-=0.32' : 0,
        );
      }

      timelineItems.forEach((item, index) => {
        gsap.from(item, {
          x: index % 2 ? 28 : -18,
          opacity: 0,
          duration: 0.62,
          ease: 'power3.out',
          clearProps: 'transform,opacity',
          scrollTrigger: {
            trigger: item,
            start: 'top 88%',
            toggleActions: 'play none none reverse',
          },
        });
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
        const scrubWords = gsap.utils.toArray<HTMLElement>(
          '[data-scrub-word]',
          scope.current ?? undefined,
        );

        imageReveals.forEach((image) => {
          gsap.fromTo(
            image,
            { scale: 0.86, opacity: 0.56 },
            {
              scale: 1,
              opacity: 1,
              ease: 'power1.out',
              scrollTrigger: {
                trigger: image,
                start: 'top 92%',
                end: 'top 52%',
                scrub: 0.65,
              },
            },
          );
        });

        copyReveals.forEach((copy) => {
          gsap.fromTo(
            copy,
            { y: 32, opacity: 0.2 },
            {
              y: 0,
              opacity: 1,
              ease: 'none',
              scrollTrigger: {
                trigger: copy,
                start: 'top 90%',
                end: 'top 56%',
                scrub: 0.65,
              },
            },
          );
        });

        const scrubTrigger = scrubWords[0]?.parentElement;
        if (scrubWords.length && scrubTrigger) {
          gsap.fromTo(
            scrubWords,
            { y: 22, opacity: 0.1 },
            {
              y: 0,
              opacity: 1,
              stagger: 0.32,
              ease: 'none',
              scrollTrigger: {
                trigger: scrubTrigger,
                start: 'top 78%',
                end: 'bottom 38%',
                scrub: 0.75,
              },
            },
          );
        }
      });

      media.add('(min-width: 900px) and (prefers-reduced-motion: no-preference)', () => {
        const pinSections = gsap.utils.toArray<HTMLElement>(
          '[data-motion-pin]',
          scope.current ?? undefined,
        );

        pinSections.forEach((section) => {
          const heading = section.querySelector<HTMLElement>('[data-pin-heading]');
          const cards = gsap.utils.toArray<HTMLElement>('[data-pin-card]', section);
          if (!heading || !cards.length) return;

          ScrollTrigger.create({
            trigger: section,
            start: 'top 7rem',
            end: 'bottom 72%',
            pin: heading,
            pinSpacing: false,
            anticipatePin: 1,
          });

          cards.forEach((card) => {
            gsap.fromTo(
              card,
              { x: 92, scale: 0.94, opacity: 0.18 },
              {
                x: 0,
                scale: 1,
                opacity: 1,
                ease: 'power2.out',
                scrollTrigger: {
                  trigger: card,
                  start: 'top 88%',
                  end: 'top 48%',
                  scrub: 0.65,
                },
              },
            );
          });
        });
      });

      return () => media.revert();
    },
    { scope, dependencies: [...dependencies], revertOnUpdate: true },
  );
}
