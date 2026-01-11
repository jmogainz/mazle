import React from 'react';

export const CannonIcon = ({ className }: { className?: string }) => (
  <svg 
    viewBox="-22 -12 44 24" 
    className={className} 
    style={{ overflow: 'visible' }}
  >
    {/* Shadow */}
    <ellipse cx="0" cy="3" rx="14.5" ry="4" fill="rgba(0,0,0,0.3)" />
    
    {/* Back Bulge */}
    <circle cx="-10" cy="0" r="11" fill="#8B7355" />
    
    {/* Barrel Body */}
    <path d="M -10 -11 L 7 -8 L 7 8 L -10 11 Z" fill="#8B7355" />
    
    {/* Top Highlight */}
    <path d="M -8 -10 L 6 -7.5 L 6 -4.5 L -8 -6 Z" fill="#A08060" />
    
    {/* Band */}
    <rect x="-4" y="-10" width="3" height="20" fill="#705030" />
    
    {/* Muzzle Swell */}
    <path d="M 7 -8 Q 11 -8 15 -11 L 15 11 Q 11 8 7 8 Z" fill="#8B7355" />
    
    {/* Muzzle Flare Highlight */}
    <path d="M 7.5 -7.5 Q 11 -7.5 14.5 -10 L 14.5 -8 Q 11 -5 7.5 -5 Z" fill="#A08060" />
    
    {/* Muzzle Ring */}
    <ellipse cx="15" cy="0" rx="4" ry="11" fill="#7A6545" />
    
    {/* Muzzle Face */}
    <ellipse cx="15" cy="0" rx="3.5" ry="11" fill="#8B7355" />
    
    {/* Muzzle Rim Highlight */}
    <path d="M 15 -11 Q 18 0 15 11" fill="none" stroke="#A08060" strokeWidth="1.2" />
    
    {/* Inner Bore Shadow */}
    <ellipse cx="15" cy="0" rx="3" ry="10" fill="#503820" />
    
    {/* Cannon Bore */}
    <ellipse cx="15" cy="0" rx="2.8" ry="9.5" fill="#1a1a1a" />
    
    {/* Deep Black Center */}
    <ellipse cx="15" cy="0" rx="2" ry="8" fill="#000000" />
  </svg>
);
