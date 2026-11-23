import React from 'react';

interface LogoProps {
  className?: string;
  size?: number;
}

/**
 * The Curator Emblem Mark (Rising sun, open book wings, winding road, sparkle stars)
 */
export function CuratorMark({ className = 'w-9 h-9', size }: LogoProps) {
  const style = size ? { width: size, height: size } : undefined;

  return (
    <svg 
      viewBox="0 0 320 320" 
      className={`shrink-0 ${className}`} 
      style={style}
      aria-label="The Curator Emblem"
    >
      <defs>
        <radialGradient id="markBgDef" cx="50%" cy="45%" r="60%">
          <stop offset="0%" stopColor="#0f2042" />
          <stop offset="60%" stopColor="#060e20" />
          <stop offset="100%" stopColor="#020612" />
        </radialGradient>
        <linearGradient id="markGoldDef" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="30%" stopColor="#fbbf24" />
          <stop offset="70%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#ea580c" />
        </linearGradient>
        <linearGradient id="markGoldLightDef" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#ffedd5" />
          <stop offset="50%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#c2410c" />
        </linearGradient>
        <radialGradient id="markSunDef" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#fffbeb" />
          <stop offset="40%" stopColor="#fef08a" />
          <stop offset="75%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#ea580c" />
        </radialGradient>
      </defs>

      {/* Rounded Squircle Container */}
      <rect x="6" y="6" width="308" height="308" rx="64" fill="url(#markBgDef)" stroke="url(#markGoldDef)" strokeWidth="2.5" />

      <g transform="translate(160, 155) scale(0.88)">
        {/* 7 Radiating Sun Beams */}
        <polygon points="0,-130 -7,-98 7,-98" fill="url(#markGoldDef)" />
        <polygon points="26,-124 16,-95 29,-91" fill="url(#markGoldDef)" />
        <polygon points="-26,-124 -29,-91 -16,-95" fill="url(#markGoldDef)" />
        <polygon points="49,-108 34,-83 46,-76" fill="url(#markGoldDef)" />
        <polygon points="-49,-108 -46,-76 -34,-83" fill="url(#markGoldDef)" />
        <polygon points="65,-85 47,-67 56,-58" fill="url(#markGoldDef)" />
        <polygon points="-65,-85 -56,-58 -47,-67" fill="url(#markGoldDef)" />

        {/* Rising Sun Core */}
        <path d="M -54,-45 A 54,54 0 0,1 54,-45 Z" fill="url(#markSunDef)" />

        {/* Outer Book Borders */}
        <path d="M -115,-32 L -115,68 L -105,74 L -105,-26 Z" fill="url(#markGoldDef)" opacity="0.9" />
        <path d="M 115,-32 L 115,68 L 105,74 L 105,-26 Z" fill="url(#markGoldDef)" opacity="0.9" />

        {/* Main Book Pages Frame */}
        <path d="M -102,-42 C -50,-40 -15,-20 0,-10 L 0,65 C -20,52 -60,45 -102,48 Z" fill="none" stroke="url(#markGoldDef)" strokeWidth="8" strokeLinejoin="round" strokeLinecap="round" />
        <path d="M 102,-42 C 50,-40 15,-20 0,-10 L 0,65 C 20,52 60,45 102,48 Z" fill="none" stroke="url(#markGoldDef)" strokeWidth="8" strokeLinejoin="round" strokeLinecap="round" />

        {/* Dark Inner Pages */}
        <path d="M -94,-34 C -50,-32 -20,-15 -6,-6 L -6,57 C -25,47 -60,41 -94,42 Z" fill="#061226" />
        <path d="M 94,-34 C 50,-32 20,-15 6,-6 L 6,57 C 25,47 60,41 94,42 Z" fill="#061226" />

        {/* Sparkle Stars on Left Page */}
        <path d="M -50,-10 Q -50,5 -35,5 Q -50,5 -50,20 Q -50,5 -65,5 Q -50,5 -50,-10 Z" fill="url(#markGoldLightDef)" />
        <path d="M -30,-22 Q -30,-15 -23,-15 Q -30,-15 -30,-8 Q -30,-15 -37,-15 Q -30,-15 -30,-22 Z" fill="url(#markGoldLightDef)" opacity="0.9" />

        {/* Winding Roadway Through Book to Horizon */}
        <path d="M 0,-10 
                 C 4,8 18,22 30,30
                 C 45,40 45,55 25,72
                 C 5,87 -20,95 -45,115
                 C -65,130 -85,150 -98,175
                 L -62,175
                 C -45,150 -25,132 -2,118
                 C 22,102 48,90 56,70
                 C 65,48 50,30 35,18
                 C 20,7 8,-2 0,-10 Z" 
              fill="url(#markGoldDef)" />

        {/* Bottom Page Spine Accent Line */}
        <path d="M -102,48 L -90,62 C -50,54 -15,62 0,72 C 15,62 50,54 90,62 L 102,48" fill="none" stroke="url(#markGoldDef)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

/**
 * Full Logo with Emblem + "THE CURATOR" typography
 */
export function CuratorFullLogo({ className = 'w-full max-w-sm', showTagline = true }: { className?: string; showTagline?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center p-6 rounded-3xl bg-[#efe8d6] border border-[#c9bc9f] shadow-2xl relative overflow-hidden ${className}`}>


      {/* Emblem */}
      <CuratorMark className="w-24 h-24 mb-4" />

      {/* Typography: THE CURATOR */}
      <div className="flex items-baseline gap-2.5 text-center">
        <span className="font-serif text-xl sm:text-2xl font-semibold text-[#8a5a24] tracking-[0.1em]">THE</span>
        <span className="font-serif text-xl sm:text-2xl font-semibold text-[#1c1a17] tracking-[0.1em]">CURATOR</span>
      </div>

      {showTagline && (
        <p className="text-xs text-[#6f675c] font-sans tracking-wide mt-2">
          Your Daily Curated Reading Digest
        </p>
      )}
    </div>
  );
}
