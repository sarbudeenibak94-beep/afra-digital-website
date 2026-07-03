'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { SplineScene } from '@/components/ui/spline';
import { Spotlight, SpotlightCard } from '@/components/ui/spotlight';
import { cn } from '@/lib/utils';

// ─── Spline scene URL ────────────────────────────────────────────────────────
const SPLINE_SCENE_URL =
  'https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode';

// ─── Variants ────────────────────────────────────────────────────────────────
const containerVariants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.12, delayChildren: 0.2 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 32 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.16, 1, 0.3, 1] },
  },
};

// ─── Feature pill chip ────────────────────────────────────────────────────────
function FeaturePill({ label }: { label: string }) {
  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold tracking-wide"
      style={{
        borderColor: 'rgba(212,175,55,0.2)',
        background: 'rgba(212,175,55,0.08)',
        color: '#D4AF37',
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: '#D4AF37', boxShadow: '0 0 6px #D4AF37' }}
      />
      {label}
    </div>
  );
}

// ─── AIRobotSection ──────────────────────────────────────────────────────────
/**
 * AIRobotSection
 *
 * A premium two-column section placed between the Hero and Marquee/Trust bars.
 * - Left: heading, subtext, feature pills, CTA button
 * - Right: interactive Spline 3D robot (lazy-loaded, no SSR)
 *
 * Uses AFRA DIGITAL design tokens and matches the existing dark-luxury aesthetic.
 * Does NOT modify any existing section or component.
 */
export function AIRobotSection({ className }: { className?: string }) {
  const [hovered, setHovered] = useState(false);

  return (
    <section
      id="ai-robot"
      className={cn(
        'relative w-full overflow-hidden py-20 md:py-28',
        className
      )}
      style={{
        background:
          'linear-gradient(180deg, #020617 0%, #060D1A 50%, #020617 100%)',
      }}
    >
      {/* ── Top / bottom gold dividers ──────────────────────────────────── */}
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

      {/* ── Ambient background glow ─────────────────────────────────────── */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 80% 60% at 60% 50%, rgba(212,175,55,0.07) 0%, transparent 70%)',
        }}
      />

      {/* ── Interactive spotlight layer ──────────────────────────────────── */}
      <Spotlight className="z-0" fill="#D4AF37" />

      <div className="c relative z-10 mx-auto max-w-[1240px] px-5 md:px-10">
        {/* Main two-column grid */}
        <motion.div
          className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16"
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
        >
          {/* ── LEFT: Text content ──────────────────────────────────────── */}
          <div className="flex flex-col items-start">
            {/* Eyebrow */}
            <motion.div variants={itemVariants} className="mb-6">
              <div
                className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.22em]"
                style={{ color: '#D4AF37' }}
              >
                <span
                  className="inline-block h-[1px] w-6"
                  style={{ background: '#D4AF37' }}
                />
                Next-Gen AI Solutions
              </div>
            </motion.div>

            {/* Heading */}
            <motion.h2
              variants={itemVariants}
              className="mb-6 text-4xl font-black leading-[0.97] tracking-tight text-white md:text-5xl lg:text-[3.5rem]"
            >
              Interactive{' '}
              <span
                style={{
                  background:
                    'linear-gradient(130deg, #F0CF5A 0%, #D4AF37 55%, #A07B18 100%)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                AI Experience
              </span>
            </motion.h2>

            {/* Subtext */}
            <motion.p
              variants={itemVariants}
              className="mb-8 max-w-md text-[0.95rem] leading-[1.85] text-[#94A3B8]"
            >
              Bring your business into the future with intelligent AI-powered
              digital solutions. From smart automation to predictive analytics —
              built for the Gulf market, scaled for the world.
            </motion.p>

            {/* Feature pills */}
            <motion.div
              variants={itemVariants}
              className="mb-10 flex flex-wrap gap-2"
            >
              {[
                'GPT Agents',
                'Smart Automation',
                'AI Copilot',
                'Real-time Analytics',
                'GCC Market Ready',
              ].map((label) => (
                <FeaturePill key={label} label={label} />
              ))}
            </motion.div>

            {/* CTA Button — matches .btn.btn-prime.btn-lg from the existing site */}
            <motion.div variants={itemVariants}>
              <motion.a
                href="#contact"
                className="inline-flex min-h-[52px] items-center gap-3 rounded-[16px] px-8 py-[15px] text-[0.95rem] font-semibold text-[#050800] transition-all"
                style={{
                  background:
                    'linear-gradient(135deg, #F0CF5A 0%, #D4AF37 60%, #B8920F 100%)',
                  boxShadow:
                    '0 4px 24px rgba(212,175,55,0.38), inset 0 1px 0 rgba(255,255,255,0.22)',
                }}
                onHoverStart={() => setHovered(true)}
                onHoverEnd={() => setHovered(false)}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.97 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              >
                Explore AI
                <motion.svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  animate={{ x: hovered ? 4 : 0 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                >
                  <path
                    d="M3 8h10M9 4l4 4-4 4"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </motion.svg>
              </motion.a>
            </motion.div>
          </div>

          {/* ── RIGHT: Spline 3D Robot ────────────────────────────────── */}
          <motion.div
            variants={itemVariants}
            className="relative flex h-[380px] items-center justify-center md:h-[480px] lg:h-[560px]"
          >
            {/* Card wrapper — glassmorphism frame */}
            <SpotlightCard
              className="relative h-full w-full overflow-hidden rounded-[28px]"
              spotlightColor="rgba(212,175,55,0.12)"
            >
              {/* Glass card background */}
              <div
                className="absolute inset-0 rounded-[28px]"
                style={{
                  background: 'rgba(255,255,255,0.025)',
                  border: '1px solid rgba(212,175,55,0.18)',
                  backdropFilter: 'blur(20px)',
                  WebkitBackdropFilter: 'blur(20px)',
                  boxShadow:
                    '0 32px 80px rgba(0,0,0,0.65), 0 0 0 1px rgba(212,175,55,0.06)',
                }}
              />

              {/* Gold ambient glow behind robot */}
              <div
                className="pointer-events-none absolute"
                style={{
                  width: '60%',
                  height: '60%',
                  borderRadius: '50%',
                  background: '#D4AF37',
                  filter: 'blur(100px)',
                  opacity: 0.08,
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                }}
              />

              {/* Spline 3D robot scene */}
              <div className="relative z-10 h-full w-full">
                <SplineScene
                  scene={SPLINE_SCENE_URL}
                  className="h-full w-full"
                />
              </div>

              {/* Corner accent — top-right gold glow */}
              <div
                className="pointer-events-none absolute right-0 top-0 h-32 w-32"
                style={{
                  background:
                    'radial-gradient(circle at top right, rgba(212,175,55,0.12) 0%, transparent 70%)',
                }}
              />

              {/* Live badge — bottom-left */}
              <div
                className="absolute bottom-5 left-5 z-20 inline-flex items-center gap-2 rounded-full px-3 py-1.5"
                style={{
                  background: 'rgba(8,18,30,0.85)',
                  border: '1px solid rgba(212,175,55,0.2)',
                  backdropFilter: 'blur(12px)',
                }}
              >
                <span
                  className="h-1.5 w-1.5 animate-pulse rounded-full"
                  style={{
                    background: '#22C55E',
                    boxShadow: '0 0 6px #22C55E',
                  }}
                />
                <span
                  className="text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: '#22C55E' }}
                >
                  Interactive
                </span>
              </div>
            </SpotlightCard>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}

export default AIRobotSection;
