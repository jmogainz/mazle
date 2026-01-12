'use client';

import { useState, useEffect } from 'react';

/**
 * Returns a responsive size value based on viewport width.
 * Uses matchMedia for efficient updates without layout thrashing.
 *
 * @param baseSize - Size to use on normal/large screens
 * @param smallSize - Size to use on small screens (< breakpoint)
 * @param breakpoint - Width threshold in pixels (default: 380)
 */
export function useResponsiveSize(
    baseSize: number,
    smallSize: number,
    breakpoint: number = 380
): number {
    const [size, setSize] = useState(baseSize);

    useEffect(() => {
        // Check if we're in browser environment
        if (typeof window === 'undefined') return;

        const mediaQuery = window.matchMedia(`(max-width: ${breakpoint}px)`);

        const updateSize = (e: MediaQueryListEvent | MediaQueryList) => {
            setSize(e.matches ? smallSize : baseSize);
        };

        // Set initial value
        updateSize(mediaQuery);

        // Listen for changes
        mediaQuery.addEventListener('change', updateSize);
        return () => mediaQuery.removeEventListener('change', updateSize);
    }, [baseSize, smallSize, breakpoint]);

    return size;
}
