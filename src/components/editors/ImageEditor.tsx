'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

interface ImageEditorProps {
    content: string; // base64 data URL
    onChange: (dataUrl: string) => void;
    readOnly?: boolean;
}

export default function ImageEditor({
    content,
    onChange,
    readOnly = false,
}: ImageEditorProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fabricRef = useRef<any>(null);
    const [activeTool, setActiveTool] = useState<'select' | 'draw' | 'text' | 'rect'>('select');
    const [brushColor, setBrushColor] = useState('#ff0000');
    const [brushSize, setBrushSize] = useState(3);

    useEffect(() => {
        let canvas: any = null;

        const initFabric = async () => {
            const fabricModule = await import('fabric');
            const fabric = fabricModule;

            if (!canvasRef.current) return;

            canvas = new fabric.Canvas(canvasRef.current, {
                selection: !readOnly,
                backgroundColor: '#1a1a2e',
            });
            fabricRef.current = canvas;

            // Load background image
            const img = await fabric.FabricImage.fromURL(content);
            if (!img) return;

            // Scale image to fit canvas
            const containerWidth = canvasRef.current.parentElement?.clientWidth || 800;
            const maxHeight = 500;
            const imgWidth = img.width || 800;
            const imgHeight = img.height || 600;
            const scaleW = containerWidth / imgWidth;
            const scaleH = maxHeight / imgHeight;
            const scaleToFit = Math.min(scaleW, scaleH, 1);

            canvas.setWidth(imgWidth * scaleToFit);
            canvas.setHeight(imgHeight * scaleToFit);

            canvas.backgroundImage = img;
            img.scaleX = scaleToFit;
            img.scaleY = scaleToFit;
            canvas.renderAll();

            // Disable context menu on canvas
            const canvasElement = canvas.getElement();
            if (canvasElement) {
                canvasElement.addEventListener('contextmenu', (e: Event) => e.preventDefault());
            }
            const upperCanvas = canvas.upperCanvasEl;
            if (upperCanvas) {
                upperCanvas.addEventListener('contextmenu', (e: Event) => e.preventDefault());
            }

            // When objects change, export for save
            if (!readOnly) {
                canvas.on('object:modified', () => exportCanvas());
                canvas.on('path:created', () => exportCanvas());
            }
        };

        initFabric();

        return () => {
            if (canvas) {
                canvas.dispose();
                fabricRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [content, readOnly]);

    const exportCanvas = useCallback(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const dataUrl = canvas.toDataURL({ format: 'png', quality: 1 });
        onChange(dataUrl);
    }, [onChange]);

    const setToolMode = useCallback(
        (tool: typeof activeTool) => {
            setActiveTool(tool);
            const canvas = fabricRef.current;
            if (!canvas) return;

            if (tool === 'draw') {
                canvas.isDrawingMode = true;
                canvas.freeDrawingBrush = new (canvas.freeDrawingBrush?.constructor || (window as any).fabric?.PencilBrush || Object)(canvas);
                if (canvas.freeDrawingBrush) {
                    canvas.freeDrawingBrush.color = brushColor;
                    canvas.freeDrawingBrush.width = brushSize;
                }
            } else {
                canvas.isDrawingMode = false;
            }
        },
        [brushColor, brushSize]
    );

    const addText = useCallback(async () => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const fabricModule = await import('fabric');
        const text = new fabricModule.IText('Type here', {
            left: 50,
            top: 50,
            fontSize: 20,
            fill: brushColor,
            fontFamily: 'Inter, sans-serif',
        });
        canvas.add(text);
        canvas.setActiveObject(text);
        canvas.renderAll();
        exportCanvas();
    }, [brushColor, exportCanvas]);

    const addRect = useCallback(async () => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const fabricModule = await import('fabric');
        const rect = new fabricModule.Rect({
            left: 50,
            top: 50,
            width: 120,
            height: 80,
            fill: 'transparent',
            stroke: brushColor,
            strokeWidth: 2,
        });
        canvas.add(rect);
        canvas.setActiveObject(rect);
        canvas.renderAll();
        exportCanvas();
    }, [brushColor, exportCanvas]);

    const deleteSelected = useCallback(() => {
        const canvas = fabricRef.current;
        if (!canvas) return;
        const objects = canvas.getActiveObjects();
        objects.forEach((obj: any) => canvas.remove(obj));
        canvas.discardActiveObject();
        canvas.renderAll();
        exportCanvas();
    }, [exportCanvas]);

    // Update brush settings when they change
    useEffect(() => {
        const canvas = fabricRef.current;
        if (canvas?.freeDrawingBrush) {
            canvas.freeDrawingBrush.color = brushColor;
            canvas.freeDrawingBrush.width = brushSize;
        }
    }, [brushColor, brushSize]);

    return (
        <div className="image-editor">
            {/* Drawing Toolbar */}
            {!readOnly && (
                <div className="image-toolbar">
                    <div className="image-toolbar-group">
                        <button
                            onClick={() => setToolMode('select')}
                            className={`image-tool-btn ${activeTool === 'select' ? 'active' : ''}`}
                            title="Select"
                        >
                            ↖ Select
                        </button>
                        <button
                            onClick={() => setToolMode('draw')}
                            className={`image-tool-btn ${activeTool === 'draw' ? 'active' : ''}`}
                            title="Draw"
                        >
                            ✏️ Draw
                        </button>
                        <button
                            onClick={addText}
                            className="image-tool-btn"
                            title="Add Text"
                        >
                            T Text
                        </button>
                        <button
                            onClick={addRect}
                            className="image-tool-btn"
                            title="Add Rectangle"
                        >
                            □ Rect
                        </button>
                    </div>

                    <div className="image-toolbar-divider" />

                    <div className="image-toolbar-group">
                        <label className="image-color-label">
                            Color
                            <input
                                type="color"
                                value={brushColor}
                                onChange={(e) => setBrushColor(e.target.value)}
                                className="image-color-picker"
                            />
                        </label>
                        <label className="image-size-label">
                            Size
                            <input
                                type="range"
                                min={1}
                                max={20}
                                value={brushSize}
                                onChange={(e) => setBrushSize(Number(e.target.value))}
                                className="image-size-slider"
                            />
                            <span>{brushSize}px</span>
                        </label>
                    </div>

                    <div className="image-toolbar-divider" />

                    <button onClick={deleteSelected} className="image-tool-btn danger" title="Delete selected">
                        🗑 Delete
                    </button>
                </div>
            )}

            {/* Canvas */}
            <div className="image-canvas-container" onContextMenu={(e) => e.preventDefault()}>
                <canvas ref={canvasRef} />
            </div>
        </div>
    );
}
