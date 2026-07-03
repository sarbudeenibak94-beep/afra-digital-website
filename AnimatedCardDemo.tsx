'use client';

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { AnimatedCard, type CardVariant } from '@/components/ui/animated-card';
import { cn } from '@/lib/utils';

// ─── Card data ────────────────────────────────────────────────────────────────
interface CardData {
  id: string;
  companyLogo: React.ReactNode;
  companyName: string;
  jobTitle: string;
  salary: string;
  tags: string[];
  postedDate: string;
  variant: CardVariant;
}

// Company logo renderers using emoji + initials for zero-asset dependency
function LogoAI() {
  return (
    <span className="text-xl" role="img" aria-label="AI">
      🤖
    </span>
  );
}
function LogoDesign() {
  return (
    <span className="text-xl" role="img" aria-label="Design">
      ✨
    </span>
  );
}
function LogoRestaurant() {
  return (
    <span className="text-xl" role="img" aria-label="Restaurant">
      🔥
    </span>
  );
}
function LogoMarketing() {
  return (
    <span className="text-xl" role="img" aria-label="Marketing">
      📈
    </span>
  );
}

const CARDS: CardData[] = [
  {
    id: 'ai',
    companyLogo: <LogoAI />,
    companyName: 'AFRA DIGITAL',
    jobTitle: 'AI Solutions & Automation',
    salary: 'Custom Pricing',
    tags: ['GPT Agents', 'ML Pipelines', 'Automation'],
    postedDate: 'Now Accepting',
    variant: 'yellow',
  },
  {
    id: 'design',
    companyLogo: <LogoDesign />,
    companyName: 'AFRA DIGITAL',
    jobTitle: 'UI/UX & Brand Identity',
    salary: 'From QAR 5,900',
    tags: ['Figma', 'Design Systems', 'Luxury Brand'],
    postedDate: 'Open',
    variant: 'purple',
  },
  {
    id: 'restaurant',
    companyLogo: <LogoRestaurant />,
    companyName: 'Cook With Fire',
    jobTitle: 'Restaurant Operating System',
    salary: 'Book a Demo',
    tags: ['QR Menu', 'KDS', 'AI Copilot'],
    postedDate: 'Live Now',
    variant: 'pink',
  },
  {
    id: 'marketing',
    companyLogo: <LogoMarketing />,
    companyName: 'AFRA DIGITAL',
    jobTitle: 'Digital Marketing & SEO',
    salary: 'ROI-Driven',
    tags: ['SEO', 'Paid Ads', 'GCC Markets'],
    postedDate: 'Available',
    variant: 'blue',
  },
];

// ─── Position config for the stacked deck layout ──────────────────────────────
type CardPosition = 'center' | 'left' | 'right' | 'hidden';

function getPositionStyle(pos: CardPosition): React.CSSProperties {
  switch (pos) {
    case 'center':
      return {
        zIndex: 30,
        transform: 'translateX(0%) scale(1) rotateY(0deg)',
        opacity: 1,
        filter: 'brightness(1)',
      };
    case 'left':
      return {
        zIndex: 20,
        transform: 'translateX(-72%) scale(0.87) rotateY(12deg)',
        opacity: 0.85,
        filter: 'brightness(0.7)',
      };
    case 'right':
      return {
        zIndex: 20,
        transform: 'translateX(72%) scale(0.87) rotateY(-12deg)',
        opacity: 0.85,
        filter: 'brightness(0.7)',
      };
    case 'hidden':
      return {
        zIndex: 10,
        transform: 'translateX(0%) scale(0.75) rotateY(0deg)',
        opacity: 0,
        pointerEvents: 'none',
        filter: 'brightness(0.4)',
      };
  }
}

// ─── AnimatedCardDemo ─────────────────────────────────────────────────────────
/**
 * AnimatedCardDemo
 *
 * Displays 4 AFRA DIGITAL service cards in a stacked deck.
 * The middle card is focused. Left/right cards are rotated and dimmed.
 * Clicking a side card animates it to center (Framer Motion layout animation).
 *
 * Placed after the AIRobotSection and before Services.
 */
export function AnimatedCardDemo({ className }: { className?: string }) {
  // Index of the currently centered card
  const [centeredIndex, setCenteredIndex] = useState(1);

  // Which 3 indices are visible: [left, center, right]
  // The 4th card is hidden off-screen
  const visibleIndices = [
    (centeredIndex - 1 + CARDS.length) % CARDS.length, // left
    centeredIndex,                                        // center
    (centeredIndex + 1) % CARDS.length,                  // right
  ];

  const getPositionForCard = useCallback(
    (cardIndex: number): CardPosition => {
      if (cardIndex === visibleIndices[1]) return 'center';
      if (cardIndex === visibleIndices[0]) return 'left';
      if (cardIndex === visibleIndices[2]) return 'right';
      return 'hidden';
    },
    [visibleIndices]
  );

  const handleCardClick = useCallback(
    (cardIndex: number, pos: CardPosition) => {
      if (pos === 'left') {
        setCenteredIndex((centeredIndex - 1 + CARDS.length) % CARDS.length);
      } else if (pos === 'right') {
        setCenteredIndex((centeredIndex + 1) % CARDS.length);
      }
    },
    [centeredIndex]
  );

  // Dot navigation
  const handleDotClick = useCallback((idx: number) => {
    setCenteredIndex(idx);
  }, []);

  return (
    <section
      id="animated-cards"
      className={cn('relative w-full overflow-hidden py-20 md:py-28', className)}
      style={{
        background:
          'linear-gradient(180deg, #020617 0%, #060D1A 50%, #020617 100%)',
      }}
    >
      {/* Section dividers */}
      <div
        className="absolute left-0 right-0 top-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(212,175,55,0.18), transparent)',
        }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 h-px"
        style={{
          background:
            'linear-gradient(90deg, transparent, rgba(212,175,55,0.18), transparent)',
        }}
      />

      {/* Ambient background */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 70% 60% at 50% 50%, rgba(212,175,55,0.05) 0%, transparent 70%)',
        }}
      />

      <div className="relative z-10 mx-auto max-w-[1240px] px-5 md:px-10">
        {/* Section header */}
        <motion.div
          className="mb-14 text-center"
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        >
          <div
            className="mb-4 inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em]"
            style={{ color: '#D4AF37' }}
          >
            <span
              className="inline-block h-[1px] w-6"
              style={{ background: '#D4AF37' }}
            />
            What We Offer
          </div>
          <h2 className="mb-4 text-3xl font-black leading-tight tracking-tight text-white md:text-4xl lg:text-5xl">
            Services That{' '}
            <span
              style={{
                background:
                  'linear-gradient(130deg, #F0CF5A 0%, #D4AF37 55%, #A07B18 100%)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}
            >
              Define Categories
            </span>
          </h2>
          <p className="mx-auto max-w-md text-[0.95rem] leading-relaxed text-[#94A3B8]">
            Click the cards to explore. Each card represents a pillar of the
            AFRA DIGITAL offering.
          </p>
        </motion.div>

        {/* Stacked deck container */}
        <div
          className="relative mx-auto"
          style={{
            height: '420px',
            maxWidth: '520px',
            perspective: '1200px',
          }}
        >
          <LayoutGroup>
            {CARDS.map((card, idx) => {
              const pos = getPositionForCard(idx);
              const style = getPositionStyle(pos);

              return (
                <motion.div
                  key={card.id}
                  layout
                  className="absolute inset-x-0 top-0 w-full"
                  animate={style}
                  transition={{
                    duration: 0.55,
                    ease: [0.16, 1, 0.3, 1],
                    layout: { duration: 0.55, ease: [0.16, 1, 0.3, 1] },
                  }}
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  <AnimatedCard
                    {...card}
                    onClick={() => handleCardClick(idx, pos)}
                    className={cn(
                      'w-full transition-shadow',
                      pos !== 'center' && 'cursor-pointer'
                    )}
                  />
                </motion.div>
              );
            })}
          </LayoutGroup>
        </div>

        {/* Dot navigation */}
        <div className="mt-10 flex items-center justify-center gap-3">
          {CARDS.map((card, idx) => (
            <button
              key={card.id}
              onClick={() => handleDotClick(idx)}
              aria-label={`Show ${card.jobTitle}`}
              className="group relative flex h-8 w-8 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
            >
              <motion.span
                className="block rounded-full"
                animate={{
                  width: idx === centeredIndex ? 20 : 6,
                  height: 6,
                  background:
                    idx === centeredIndex
                      ? '#D4AF37'
                      : 'rgba(212,175,55,0.3)',
                  boxShadow:
                    idx === centeredIndex
                      ? '0 0 8px rgba(212,175,55,0.6)'
                      : 'none',
                }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              />
            </button>
          ))}
        </div>

        {/* Prev / Next arrows */}
        <div className="mt-6 flex items-center justify-center gap-3">
          <motion.button
            onClick={() =>
              setCenteredIndex((centeredIndex - 1 + CARDS.length) % CARDS.length)
            }
            className="flex h-10 w-10 items-center justify-center rounded-full border text-white outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
            style={{
              borderColor: 'rgba(212,175,55,0.25)',
              background: 'rgba(212,175,55,0.05)',
            }}
            whileHover={{
              background: 'rgba(212,175,55,0.12)',
              borderColor: 'rgba(212,175,55,0.5)',
              scale: 1.08,
            }}
            whileTap={{ scale: 0.93 }}
            aria-label="Previous card"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M9 2L4 7l5 5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </motion.button>
          <motion.button
            onClick={() =>
              setCenteredIndex((centeredIndex + 1) % CARDS.length)
            }
            className="flex h-10 w-10 items-center justify-center rounded-full border text-white outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37]"
            style={{
              borderColor: 'rgba(212,175,55,0.25)',
              background: 'rgba(212,175,55,0.05)',
            }}
            whileHover={{
              background: 'rgba(212,175,55,0.12)',
              borderColor: 'rgba(212,175,55,0.5)',
              scale: 1.08,
            }}
            whileTap={{ scale: 0.93 }}
            aria-label="Next card"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M5 2l5 5-5 5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </motion.button>
        </div>
      </div>
    </section>
  );
}

export default AnimatedCardDemo;
