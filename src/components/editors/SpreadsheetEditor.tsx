'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface SpreadsheetEditorProps {
    rows: any[][];
    onChange: (rows: any[][]) => void;
    readOnly?: boolean;
}

export default function SpreadsheetEditor({
    rows,
    onChange,
    readOnly = false,
}: SpreadsheetEditorProps) {
    const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
    const [editValue, setEditValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editingCell && inputRef.current) {
            inputRef.current.focus();
        }
    }, [editingCell]);

    const getColumnLabel = (index: number): string => {
        let label = '';
        let i = index;
        while (i >= 0) {
            label = String.fromCharCode(65 + (i % 26)) + label;
            i = Math.floor(i / 26) - 1;
        }
        return label;
    };

    const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0) || 3;

    const handleCellClick = useCallback(
        (rowIndex: number, colIndex: number, value: any) => {
            if (readOnly) return;
            setEditingCell({ row: rowIndex, col: colIndex });
            setEditValue(value?.toString() ?? '');
        },
        [readOnly]
    );

    const commitEdit = useCallback(() => {
        if (!editingCell) return;
        const { row, col } = editingCell;
        const newRows = rows.map((r) => [...r]);
        if (!newRows[row]) newRows[row] = [];
        // Pad row to have enough columns
        while (newRows[row].length <= col) newRows[row].push('');
        newRows[row][col] = editValue;
        onChange(newRows);
        setEditingCell(null);
    }, [editingCell, editValue, rows, onChange]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                commitEdit();
            } else if (e.key === 'Escape') {
                setEditingCell(null);
            }
        },
        [commitEdit]
    );

    const addRow = useCallback(() => {
        const newRow = new Array(maxCols).fill('');
        onChange([...rows, newRow]);
    }, [rows, maxCols, onChange]);

    const deleteRow = useCallback(
        (rowIndex: number) => {
            const newRows = rows.filter((_, i) => i !== rowIndex);
            onChange(newRows);
        },
        [rows, onChange]
    );

    const addColumn = useCallback(() => {
        const newRows = rows.map((row) => [...row, '']);
        onChange(newRows);
    }, [rows, onChange]);

    return (
        <div className="spreadsheet-editor">
            {/* Toolbar */}
            {!readOnly && (
                <div className="spreadsheet-toolbar">
                    <button onClick={addRow} className="spreadsheet-btn">
                        <span>+</span> Add Row
                    </button>
                    <button onClick={addColumn} className="spreadsheet-btn">
                        <span>+</span> Add Column
                    </button>
                    <span className="spreadsheet-info">
                        {rows.length} rows × {maxCols} columns
                    </span>
                </div>
            )}

            {/* Table */}
            <div className="spreadsheet-scroll">
                <table className="spreadsheet-table">
                    <thead>
                        <tr>
                            <th className="spreadsheet-row-num">#</th>
                            {Array.from({ length: maxCols }).map((_, ci) => (
                                <th key={ci} className="spreadsheet-col-header">
                                    {getColumnLabel(ci)}
                                </th>
                            ))}
                            {!readOnly && <th className="spreadsheet-action-col" />}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, ri) => (
                            <tr key={ri}>
                                <td className="spreadsheet-row-num">{ri + 1}</td>
                                {Array.from({ length: maxCols }).map((_, ci) => {
                                    const isEditing =
                                        editingCell?.row === ri && editingCell?.col === ci;
                                    const cellValue = row[ci] ?? '';

                                    return (
                                        <td
                                            key={ci}
                                            className={`spreadsheet-cell ${isEditing ? 'editing' : ''}`}
                                            onClick={() => handleCellClick(ri, ci, cellValue)}
                                        >
                                            {isEditing ? (
                                                <input
                                                    ref={inputRef}
                                                    type="text"
                                                    value={editValue}
                                                    onChange={(e) => setEditValue(e.target.value)}
                                                    onBlur={commitEdit}
                                                    onKeyDown={handleKeyDown}
                                                    className="spreadsheet-input"
                                                />
                                            ) : (
                                                <span className="spreadsheet-cell-value">
                                                    {cellValue?.toString() || ''}
                                                </span>
                                            )}
                                        </td>
                                    );
                                })}
                                {!readOnly && (
                                    <td className="spreadsheet-action-col">
                                        <button
                                            onClick={() => deleteRow(ri)}
                                            className="spreadsheet-delete-btn"
                                            title="Delete row"
                                        >
                                            ×
                                        </button>
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
