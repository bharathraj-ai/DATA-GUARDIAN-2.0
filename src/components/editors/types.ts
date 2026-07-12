export type ElementType = "text" | "image" | "table" | "zipentry";

export interface BaseElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
}

export interface TextElementData extends BaseElement {
  type: "text";
  content: string;
  font?: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  color?: string;
}

export interface ImageElementData extends BaseElement {
  type: "image";
  src: string;
}

export interface TableCellData {
  value: string;
  bgColor?: string;
  textColor?: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
}

export interface TableElementData extends BaseElement {
  type: "table";
  hasHeader: boolean;
  rows: TableCellData[][];
  colW?: number;
  rowH?: number;
  colWidths?: number[];
}

export interface ZipEntryElementData extends BaseElement {
  type: "zipentry";
  path: string;
  ext: string;
  size: number;
  preview?: string | null;
}

export type EditorElement = TextElementData | ImageElementData | TableElementData | ZipEntryElementData;

export interface PageData {
  id: string;
  width: number;
  height: number;
  elements: EditorElement[];
  bgImage: string | null;
  order?: number;
  createdAt?: number;
}

export interface DocumentData {
  type: string;
  name: string;
  pages: PageData[];
  metadata?: {
    sheetNames?: string[];
    activeSheet?: number;
    [key: string]: any;
  };
}
