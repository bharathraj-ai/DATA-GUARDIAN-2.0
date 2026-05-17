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
            <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0f1117' }}>
                <div style={{ 
                    padding: '12px 20px', 
                    background: 'linear-gradient(90deg, #1e1b4b, #1a1a2e)', 
                    borderBottom: '1px solid rgba(99,102,241,0.2)', 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between', 
                    gap: '8px', 
                    flexShrink: 0 
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                        {onClose && (
                            <button 
                                onClick={onClose}
                                style={{
                                    background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff',
                                    padding: '6px 12px', borderRadius: '6px', cursor: 'pointer', fontSize: '13px',
                                    fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px'
                                }}
                            >
                                &larr; Back
                            </button>
                        )}
                        <span style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 600 }}>
                            {file.name}
                        </span>
                        <span style={{ fontSize: '11px', background: 'rgba(239,68,68,0.1)', color: '#ef4444', padding: '3px 8px', borderRadius: '12px', border: '1px solid rgba(239,68,68,0.2)', fontWeight: 700 }}>
                            VIEW ONLY PDF
                        </span>
                    </div>
                    <div style={{ color: '#94a3b8', fontSize: '12px' }}>
                        🔒 Secure Preview Active
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
