import { NextResponse } from 'next/server';

/**
 * Health check endpoint for container orchestration (Docker, K8s).
 * Returns 200 OK with basic application status.
 */
export async function GET() {
    return NextResponse.json(
        {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: process.env.npm_package_version || '2.0.0',
            uptime: process.uptime(),
        },
        {
            status: 200,
            headers: {
                'Cache-Control': 'no-cache, no-store, must-revalidate',
            },
        }
    );
}
