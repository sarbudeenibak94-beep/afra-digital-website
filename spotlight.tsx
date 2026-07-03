'use client';

import React, { useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface SpotlightProps {
  className?: string;
  /** Fill color of the spotlight cone — defaults to gold */
  fill?: string;
}

/**
 * Spotlight — premium interactive light cone that follows mouse cursor.
 *
 * Renders as an absolutely-positioned SVG spotlight effect. Pointer events
 * are set to none so it never blocks clicks on content behind it.
 * Framer Motion spring ensures buttery-smooth tracking.
 */
export function Spotlight({ className, fill = '#D4AF37' }: SpotlightProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isVisible, setIsVisible] = useState(false);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setPosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
      if (!isVisible) setIsVisible(true);
    },
    [isVisible]
  );

  const handleMouseLeave = useCallback(() => {
    setIsVisible(false);
  }, []);

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={cn('absolute inset-0 overflow-hidden', className)}
      style={{ pointerEvents: 'none' }}
    >
      {/* SVG Spotlight cone */}
      <motion.div
        className="pointer-events-none absolute"
        style={{
          left: position.x,
          top: position.y,
          transform: 'translate(-50%, -50%)',
        }}
        animate={{
          opacity: isVisible ? 1 : 0,
          scale: isVisible ? 1 : 0.85,
        }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="680"
          height="680"
          viewBox="0 0 680 680"
          fill="none"
          style={{ transform: 'translate(-50%, -50%)' }}
        >
          <defs>
            <radialGradient
              id="spotlight-gradient"
              cx="50%"
              cy="50%"
              r="50%"
            >
              <stop
                offset="0%"
                stopColor={fill}
                stopOpacity="0.18"
              />
              <stop
                offset="40%"
                stopColor={fill}
                stopOpacity="0.06"
              />
              <stop
                offset="100%"
                stopColor={fill}
                stopOpacity="0"
              />
            </radialGradient>
          </defs>
          <ellipse
            cx="340"
            cy="340"
            rx="340"
            ry="340"
            fill="url(#spotlight-gradient)"
          />
        </svg>
      </motion.div>

      {/* Static ambient glow — always visible, soft background warmth */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(ellipse 70% 60% at 30% 50%, rgba(212,175,55,0.06) 0%, transparent 70%)`,
        }}
      />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   SpotlightCard — wraps any content with interactive spotlight tracking
   built directly into the wrapper div (no separate event container needed).
───────────────────────────────────────────────────────────────────────── */

interface SpotlightCardProps {
  children: React.ReactNode;
  className?: string;
  spotlightColor?: string;
}

export function SpotlightCard({
  children,
  className,
  spotlightColor = 'rgba(212,175,55,0.15)',
}: SpotlightCardProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!divRef.current || isFocused) return;
      const rect = divRef.current.getBoundingClientRect();
      setPosition({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    },
    [isFocused]
  );

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setOpacity(1)}
      onMouseLeave={() => setOpacity(0)}
      onFocus={() => { setIsFocused(true); setOpacity(1); }}
      onBlur={() => { setIsFocused(false); setOpacity(0); }}
      className={cn('relative overflow-hidden', className)}
    >
      {/* Radial spotlight that tracks the mouse */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-300"
        style={{
          opacity,
          background: `radial-gradient(600px circle at ${position.x}px ${position.y}px, ${spotlightColor}, transparent 40%)`,
        }}
      />
      {children}
    </div>
  );
}

export default Spotlight;
