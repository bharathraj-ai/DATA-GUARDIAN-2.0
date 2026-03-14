'use client';

import { useEffect, useRef, ReactNode } from 'react';

interface ScrollRevealProps {
    children: ReactNode;
    className?: string;
    delay?: number; // 1-4 for delay classes
    threshold?: number;
}

export default function ScrollReveal({
    children,
    className = '',
    delay,
    threshold = 0.15,
}: ScrollRevealProps) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;

        // Respect reduced motion preference
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReducedMotion) {
            el.classList.add('visible');
            return;
        }

        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting) {
                    el.classList.add('visible');
                    observer.unobserve(el); // Only animate once
                }
            },
            { threshold, rootMargin: '0px 0px -40px 0px' }
        );

        observer.observe(el);
        return () => observer.disconnect();
    }, [threshold]);

    const delayClass = delay ? `scroll-reveal-delay-${delay}` : '';

    return (
        <div
            ref={ref}
            className={`scroll-reveal ${delayClass} ${className}`.trim()}
        >
            {children}
        </div>
    );
}

