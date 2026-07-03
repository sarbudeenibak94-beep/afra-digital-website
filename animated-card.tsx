'use client';

import React, { useRef, useCallback } from 'react';
import {
  motion,
  useMotionValue,
  useSpring,
  useTransform,
  LayoutGroup,
} from 'framer-motion';
import { cn } from '@/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

export type CardVariant = 'pink' | 'yellow' | 'blue' | 'purple';

export interface AnimatedCardProps {
  companyLogo: React.ReactNode;
  companyName: string;
  jobTitle: string;
  salary: string;
  tags: string[];
  postedDate: string;
  variant: CardVariant;
  className?: string;
  onClick?: () => void;
}

// ─── Variant classes ──────────────────────────────────────────────────────────
const variantClasses: Record<
  CardVariant,
  { bg: string; border: string; tag: string; tagText: string; glow: string; accent: string }
> = {
  pink: {
    bg: 'rgba(236,72,153,0.06)',
    border: 'rgba(236,72,153,0.25)',
    tag: 'rgba(236,72,153,0.12)',
    tagText: '#F472B6',
    glow: 'rgba(236,72,153,0.2)',
    accent: '#EC4899',
  },
  yellow: {
    bg: 'rgba(212,175,55,0.06)',
    border: 'rgba(212,175,55,0.25)',
    tag: 'rgba(212,175,55,0.12)',
    tagText: '#F0CF5A',
    glow: 'rgba(212,175,55,0.22)',
    accent: '#D4AF37',
  },
  blue: {
    bg: 'rgba(99,102,241,0.06)',
    border: 'rgba(99,102,241,0.25)',
    tag: 'rgba(99,102,241,0.12)',
    tagText: '#818CF8',
    glow: 'rgba(99,102,241,0.2)',
    accent: '#6366F1',
  },
  purple: {
    bg: 'rgba(168,85,247,0.06)',
    border: 'rgba(168,85,247,0.25)',
    tag: 'rgba(168,85,247,0.12)',
    tagText: '#C084FC',
    glow: 'rgba(168,85,247,0.2)',
    accent: '#A855F7',
  },
};

// Spring config — snappy return, smooth tracking
const SPRING_CONFIG = { stiffness: 300, damping: 30, mass: 0.5 };

// ─── AnimatedCard ─────────────────────────────────────────────────────────────
/**
 * AnimatedCard — premium 3D tilt card with:
 * - Mouse-tracked rotateX / rotateY via Framer Motion useMotionValue
 * - Spring physics for buttery return animation
 * - translateZ depth layers (company logo, title, salary float above surface)
 * - Variant-based color system (pink / yellow / blue / purple)
 * - Keyboard focusable + ARIA accessible
 * - layout animation prop for stacked-card reordering
 */
export function AnimatedCard({
  companyLogo,
  companyName,
  jobTitle,
  salary,
  tags,
  postedDate,
  variant,
  className,
  onClick,
}: AnimatedCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const v = variantClasses[variant];

  // ── Motion values ──────────────────────────────────────────────────────────
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);

  // Spring-smoothed versions
  const springX = useSpring(mouseX, SPRING_CONFIG);
  const springY = useSpring(mouseY, SPRING_CONFIG);

  // Map spring values → rotation angles (max ±14deg)
  const rotateX = useTransform(springY, [-0.5, 0.5], ['14deg', '-14deg']);
  const rotateY = useTransform(springX, [-0.5, 0.5], ['-14deg', '14deg']);

  // Shine overlay opacity tracks horizontal mouse
  const shineOpacity = useTransform(springX, [-0.5, 0, 0.5], [0.15, 0, 0.15]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!cardRef.current) return;
      const { left, top, width, height } =
        cardRef.current.getBoundingClientRect();
      // Normalise to [-0.5, 0.5]
      mouseX.set((e.clientX - left - width / 2) / width);
      mouseY.set((e.clientY - top - height / 2) / height);
    },
    [mouseX, mouseY]
  );

  const handleMouseLeave = useCallback(() => {
    mouseX.set(0);
    mouseY.set(0);
  }, [mouseX, mouseY]);

  return (
    <motion.div
      ref={cardRef}
      layout
      onClick={onClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onKeyDown={(e) => e.key === 'Enter' && onClick?.()}
      tabIndex={0}
      role="button"
      aria-label={`${jobTitle} at ${companyName}`}
      className={cn(
        'relative cursor-pointer select-none rounded-[22px] p-[1px] outline-none focus-visible:ring-2 focus-visible:ring-[#D4AF37] focus-visible:ring-offset-2 focus-visible:ring-offset-[#020617]',
        className
      )}
      style={{
        perspective: '1000px',
        transformStyle: 'preserve-3d',
      }}
      whileHover={{ scale: 1.02 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* ── 3D tilt container ─────────────────────────────────────────── */}
      <motion.div
        className="relative h-full w-full overflow-hidden rounded-[22px]"
        style={{
          rotateX,
          rotateY,
          transformStyle: 'preserve-3d',
          background: v.bg,
          border: `1px solid ${v.border}`,
          boxShadow: `0 20px 60px rgba(0,0,0,0.55), 0 0 40px ${v.glow}`,
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
        }}
      >
        {/* ── Shine sweep overlay ──────────────────────────────────────── */}
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-[22px]"
          style={{
            opacity: shineOpacity,
            background:
              'linear-gradient(105deg, rgba(255,255,255,0) 40%, rgba(255,255,255,0.4) 50%, rgba(255,255,255,0) 60%)',
          }}
        />

        {/* ── Card accent glow — top corner ───────────────────────────── */}
        <div
          className="pointer-events-none absolute right-0 top-0 h-36 w-36 rounded-full"
          style={{
            background: `radial-gradient(circle at top right, ${v.glow}, transparent 70%)`,
            filter: 'blur(20px)',
            transform: 'translate(30%, -30%)',
          }}
        />

        {/* ── Card body — translateZ elevates above tilt surface ─────── */}
        <div
          className="relative p-6"
          style={{ transform: 'translateZ(12px)' }}
        >
          {/* Header row */}
          <div className="mb-4 flex items-start justify-between gap-3">
            {/* Company logo */}
            <motion.div
              className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl"
              style={{
                background: v.tag,
                border: `1px solid ${v.border}`,
                transform: 'translateZ(24px)',
                boxShadow: `0 8px 24px ${v.glow}`,
              }}
            >
              {companyLogo}
            </motion.div>

            {/* Posted date */}
            <span
              className="mt-1 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: '#475569' }}
            >
              {postedDate}
            </span>
          </div>

          {/* Company name */}
          <p
            className="mb-1 text-xs font-semibold uppercase tracking-widest"
            style={{ color: v.tagText }}
          >
            {companyName}
          </p>

          {/* Job title — elevated with translateZ */}
          <motion.h3
            className="mb-3 text-lg font-bold leading-snug text-white"
            style={{ transform: 'translateZ(20px)' }}
          >
            {jobTitle}
          </motion.h3>

          {/* Divider */}
          <div
            className="mb-3 h-px w-full"
            style={{ background: `${v.border}` }}
          />

          {/* Salary — floating */}
          <motion.div
            className="mb-4 flex items-center gap-2"
            style={{ transform: 'translateZ(16px)' }}
          >
            <span
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: '#475569' }}
            >
              Salary
            </span>
            <span
              className="text-sm font-bold"
              style={{ color: v.tagText }}
            >
              {salary}
            </span>
          </motion.div>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
                style={{
                  background: v.tag,
                  color: v.tagText,
                  border: `1px solid ${v.border}`,
                }}
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default AnimatedCard;
