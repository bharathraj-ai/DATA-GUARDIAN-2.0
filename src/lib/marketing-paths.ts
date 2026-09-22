/** Public marketing routes — skip eager NextAuth session on first paint. */
export function isMarketingPath(pathname: string | null | undefined): boolean {
    if (!pathname) return false;
    if (pathname === '/') return true;
    return (
        pathname === '/services' ||
        pathname.startsWith('/services/') ||
        pathname === '/how-it-works' ||
        pathname.startsWith('/how-it-works/') ||
        pathname === '/legal' ||
        pathname.startsWith('/legal/') ||
        pathname === '/pricing' ||
        pathname.startsWith('/pricing/') ||
        pathname === '/help' ||
        pathname.startsWith('/help/') ||
        pathname === '/docs' ||
        pathname.startsWith('/docs/') ||
        pathname === '/status' ||
        pathname.startsWith('/status/')
    );
}
