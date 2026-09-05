/** Public marketing routes — no NextAuth SessionProvider on the tree. */
export function isMarketingPath(pathname: string | null | undefined): boolean {
    if (!pathname) return false;
    if (pathname === '/') return true;
    if (pathname === '/services' || pathname.startsWith('/services/')) return true;
    if (pathname === '/how-it-works' || pathname.startsWith('/how-it-works/')) return true;
    if (pathname === '/legal' || pathname.startsWith('/legal/')) return true;
    if (pathname === '/help' || pathname.startsWith('/help/')) return true;
    if (pathname === '/docs' || pathname.startsWith('/docs/')) return true;
    if (pathname === '/status' || pathname.startsWith('/status/')) return true;
    return false;
}
