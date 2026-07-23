import type { Workbook } from 'exceljs';

export interface DocumentDataLike {
    type: string;
    name?: string;
    pages: any[];
    metadata?: any;
}

export class WorkbookAdapter {
    static async generateWorkbook(currentDoc: DocumentDataLike): Promise<Buffer> {
        // Dynamic import to avoid bloating client bundle
        const ExcelJS = await import('exceljs');
        
        // Handle commonJS or ESM default exports
        const ExcelJSModule = ExcelJS.default || ExcelJS;
        
        const builder = new WorkbookBuilder(ExcelJSModule, currentDoc);
        const workbook = builder.build();
        
        const formatter = new WorkbookFormatter(workbook);
        formatter.format();
        
        const exporter = new WorkbookExporter(workbook);
        return await exporter.export();
    }
}

class WorkbookBuilder {
    private doc: DocumentDataLike;
    private workbook: Workbook;

    constructor(ExcelJSModule: any, doc: DocumentDataLike) {
        this.doc = doc;
        this.workbook = new ExcelJSModule.Workbook();
        this.workbook.creator = 'Data Guardian';
        this.workbook.created = new Date();
    }

    build(): Workbook {
        // Find all table elements across all pages
        let pageIndex = 0;

        for (const page of this.doc.pages) {
            const elements = page.elements || [];
            // Filter elements: only tables with rows
            const tableElements = elements.filter((el: any) => el.type === 'table' && Array.isArray(el.rows) && el.rows.length > 0);

            for (const tableEl of tableElements) {
                let sheetName = (this.doc.pages[pageIndex]?.title) || (this.doc.metadata?.sheetNames?.[pageIndex]) || `Sheet${pageIndex + 1}`;
                while (this.workbook.getWorksheet(sheetName)) {
                    sheetName = `${sheetName}_dup`;
                }
                const sheet = this.workbook.addWorksheet(sheetName);

                // Data validation: clean duplicate rows, etc.
                const rows = tableEl.rows || [];
                const uniqueRows = new Set<string>();
                
                for (const row of rows) {
                    // row is an array of cells, which might be objects or strings
                    const rowData = row.map((cell: any) => {
                        if (cell === null || cell === undefined) return '';
                        return typeof cell === 'object' ? (cell.value || '') : cell;
                    });
                    
                    const rowString = JSON.stringify(rowData);
                    // Filter duplicates if they are exactly identical data rows
                    if (!uniqueRows.has(rowString)) {
                        uniqueRows.add(rowString);
                        sheet.addRow(rowData);
                    }
                }

                if (this.doc.metadata?.activeSheet === pageIndex) {
                    this.workbook.views = [{ activeTab: pageIndex } as any];
                }
            }
            pageIndex++;
        }

        // If no tables were found, add an empty sheet to prevent errors
        if (this.workbook.worksheets.length === 0) {
            this.workbook.addWorksheet('Sheet1');
        }

        return this.workbook;
    }
}

class WorkbookFormatter {
    private workbook: Workbook;

    constructor(workbook: Workbook) {
        this.workbook = workbook;
    }

    format(): void {
        this.workbook.worksheets.forEach(sheet => {
            if (sheet.rowCount === 0) return;

            // 1. Freeze Panes (first row)
            sheet.views = [
                { state: 'frozen', xSplit: 0, ySplit: 1 }
            ];

            // 2. Style Header (dark blue, white bold text)
            const headerRow = sheet.getRow(1);
            if (headerRow) {
                headerRow.eachCell(cell => {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FF1F4E78' } // Dark blue
                    };
                    cell.font = {
                        bold: true,
                        color: { argb: 'FFFFFFFF' } // White
                    };
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FF000000' } },
                        left: { style: 'thin', color: { argb: 'FF000000' } },
                        bottom: { style: 'thin', color: { argb: 'FF000000' } },
                        right: { style: 'thin', color: { argb: 'FF000000' } }
                    };
                });
                headerRow.height = 24;
            }

            // 3. Style Data Rows & Alternate Colors
            for (let i = 2; i <= sheet.rowCount; i++) {
                const row = sheet.getRow(i);
                if (!row) continue;
                
                row.eachCell({ includeEmpty: true }, (cell) => {
                    // Alternate row colors (white and light gray)
                    const isEven = i % 2 === 0;
                    if (isEven) {
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFF2F2F2' } // Light gray
                        };
                    }

                    // Borders
                    cell.border = {
                        top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                        left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                        bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
                        right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
                    };

                    cell.alignment = { vertical: 'middle', wrapText: true };
                });
            }

            // 4. Auto-width Columns
            if (sheet.columns) {
                sheet.columns.forEach((col) => {
                    if (!col || !col.eachCell) return;
                    let maxLength = 10;
                    col.eachCell({ includeEmpty: true }, (cell) => {
                        const textLength = cell.value ? cell.value.toString().length : 0;
                        if (textLength > maxLength) {
                            maxLength = textLength;
                        }
                    });
                    // Add some padding, limit max width to prevent giant columns
                    col.width = Math.min(maxLength + 2, 50);
                });
            }
        });
    }
}

class WorkbookExporter {
    private workbook: Workbook;

    constructor(workbook: Workbook) {
        this.workbook = workbook;
    }

    async export(): Promise<Buffer> {
        // writeBuffer() returns ArrayBuffer in browser and Buffer in Node.
        // Convert to Buffer uniformly for both environments to handle downstream.
        const buffer = await this.workbook.xlsx.writeBuffer();
        return Buffer.from(buffer);
    }
}
