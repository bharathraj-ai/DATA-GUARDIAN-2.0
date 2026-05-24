'use client';

import React, { useEffect, useState } from 'react';
import { SecurityShield } from '@/components/view/SecurityShield';

interface SecurePDFViewerProps {
    file: File;
    token: string;
    onClose?: () => void;
}

export default function SecurePDFViewer({ file, token, onClose }: SecurePDFViewerProps) {
    const [pdfUrl, setPdfUrl] = useState<string>('');

    useEffect(() => {
        const url = URL.createObjectURL(file);
        // Add #toolbar=0 to restrict PDF native viewer downloading/printing directly 
        // while allowing basic scroll navigation and zoom via ctrl+scroll.
        setPdfUrl(url + '#toolbar=0');
        return () => URL.revokeObjectURL(url);
    }, [file]);

    return (
        <SecurityShield token={token} maxTabSwitches={3} enableWatermark={true}>
            <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#09090b' }}>
                <div style={{ 
                    padding: '12px 20px', 
                    background: '#09090b', 
                    borderBottom: '1px solid #27272a', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between', 
                    gap: '8px', 
                    flexShrink: 0 
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {onClose && (
                            <button 
                                onClick={onClose}
                                style={{
                                    background: '#27272a', border: '1px solid #3f3f46', color: '#d4d4d8',
                                    padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
                                    fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px',
                                    fontFamily: "'Inter', sans-serif"
                                }}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5"/><polyline points="12 19 5 12 12 5"/></svg>
                                Back
                            </button>
                        )}
                        <span style={{ color: '#d4d4d8', fontSize: '14px', fontWeight: 500, fontFamily: "'Inter', sans-serif" }}>
                            {file.name}
                        </span>
                        <span style={{ fontSize: '10px', background: 'rgba(220,38,38,0.1)', color: '#dc2626', padding: '3px 8px', borderRadius: '4px', border: '1px solid rgba(220,38,38,0.2)', fontWeight: 600, letterSpacing: '0.04em', fontFamily: "'Inter', sans-serif" }}>
                            VIEW ONLY
                        </span>
                    </div>
                    <div style={{ color: '#52525b', fontSize: '12px', fontFamily: "'Inter', sans-serif", display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                        Secure Preview
                    </div>
                </div>
                <div style={{ flex: 1, position: 'relative' }}>
                    {pdfUrl && (
                        <iframe 
                            src={pdfUrl} 
                            style={{ width: '100%', height: '100%', border: 'none' }} 
                            title="Secure PDF Viewer"
                        />
                    )}
                    {/* Add an overlay to catch right-clicks before they hit the iframe */}
                    <div 
                        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                        }}
                    />
                </div>
            </div>
        </SecurityShield>
    );
}
