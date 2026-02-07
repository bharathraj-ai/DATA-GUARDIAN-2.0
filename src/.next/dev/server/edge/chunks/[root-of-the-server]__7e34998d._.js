(globalThis.TURBOPACK || (globalThis.TURBOPACK = [])).push(["chunks/[root-of-the-server]__7e34998d._.js",
"[externals]/node:buffer [external] (node:buffer, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:buffer", () => require("node:buffer"));

module.exports = mod;
}),
"[externals]/node:async_hooks [external] (node:async_hooks, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("node:async_hooks", () => require("node:async_hooks"));

module.exports = mod;
}),
"[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/src/middleware.ts [middleware-edge] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "config",
    ()=>config,
    "middleware",
    ()=>middleware
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$next$2f$dist$2f$esm$2f$api$2f$server$2e$js__$5b$middleware$2d$edge$5d$__$28$ecmascript$29$__$3c$locals$3e$__ = __turbopack_context__.i("[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/node_modules/next/dist/esm/api/server.js [middleware-edge] (ecmascript) <locals>");
var __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$next$2f$dist$2f$esm$2f$server$2f$web$2f$exports$2f$index$2e$js__$5b$middleware$2d$edge$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/Downloads/DATA GAURDIAN/DATA GAURDIAN/DATA-GUARDIAN-2.0/node_modules/next/dist/esm/server/web/exports/index.js [middleware-edge] (ecmascript)");
;
function middleware(request) {
    const response = __TURBOPACK__imported__module__$5b$project$5d2f$Downloads$2f$DATA__GAURDIAN$2f$DATA__GAURDIAN$2f$DATA$2d$GUARDIAN$2d$2$2e$0$2f$node_modules$2f$next$2f$dist$2f$esm$2f$server$2f$web$2f$exports$2f$index$2e$js__$5b$middleware$2d$edge$5d$__$28$ecmascript$29$__["NextResponse"].next();
    // Disable caching for all dynamic routes
    if (request.nextUrl.pathname.startsWith('/share/') || request.nextUrl.pathname.startsWith('/view/') || request.nextUrl.pathname.startsWith('/revoke/') || request.nextUrl.pathname.startsWith('/signup') || request.nextUrl.pathname.startsWith('/api/')) {
        response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        response.headers.set('Pragma', 'no-cache');
        response.headers.set('Expires', '0');
        response.headers.set('Surrogate-Control', 'no-store');
    }
    return response;
}
const config = {
    matcher: [
        '/share/:path*',
        '/view/:path*',
        '/revoke/:path*',
        '/signup',
        '/api/:path*'
    ]
};
}),
]);

//# sourceMappingURL=%5Broot-of-the-server%5D__7e34998d._.js.map