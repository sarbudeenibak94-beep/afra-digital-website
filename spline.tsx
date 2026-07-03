'use client';

import React, { Suspense, lazy } from 'react';
import { cn } from '@/lib/utils';

// Lazy load to avoid SSR issues with WebGL
const SplineReact = lazy(() => import('@splinetool/react-spline'));

interface SplineSceneProps {
  scene: string;
  className?: string;
}

// Fallback shown while Spline loads
function SplineLoadingFallback() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      {/* Animated gold ring placeholder */}
      <div className="relative flex items-center justify-center">
        {/* Outer pulsing ring */}
        <div
          className="absolute h-48 w-48 animate-ping rounded-full border border-[rgba(212,175,55,0.2)]"
          style={{ animationDuration: '2.5s' }}
        />
        {/* Mid ring */}
        <div
          className="absolute h-32 w-32 animate-ping rounded-full border border-[rgba(212,175,55,0.35)]"
          style={{ animationDuration: '2s', animationDelay: '0.3s' }}
        />
        {/* Center glow */}
        <div
          className="relative h-16 w-16 rounded-full"
          style={{
            background:
              'radial-gradient(circle, rgba(212,175,55,0.4) 0%, rgba(212,175,55,0.1) 50%, transparent 100%)',
            boxShadow: '0 0 40px rgba(212,175,55,0.4), inset 0 0 20px rgba(212,175,55,0.2)',
          }}
        >
          {/* Inner AD mark */}
          <div className="absolute inset-0 flex items-center justify-center text-[#D4AF37] font-black text-lg">
            AI
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * SplineScene — lazy-loaded Spline 3D component.
 * Wraps @splinetool/react-spline with Suspense + loading fallback.
 * Pointer events are passthrough so the spotlight / UI behind it remains clickable.
 *
 * @param scene   - Spline scene URL (.splinecode)
 * @param className - Optional Tailwind / CSS class override
 */
export function SplineScene({ scene, className }: SplineSceneProps) {
  return (
    <div className={cn('relative h-full w-full', className)}>
      <Suspense fallback={<SplineLoadingFallback />}>
        <SplineReact
          scene={scene}
          style={{ width: '100%', height: '100%' }}
        />
      </Suspense>
    </div>
  );
}

export default SplineScene;
