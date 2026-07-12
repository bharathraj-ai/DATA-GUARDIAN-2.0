import React, { useState } from "react";
import { DocumentData } from "../types";
import { SpreadsheetView, SheetRuntimeState } from "./SpreadsheetView";
import { WorkbookTabs } from "./WorkbookTabs";
import { TableActions } from "./TableElement";

interface SpreadsheetAppProps {
  doc: DocumentData;
  scale: number;
  activePage: number;
  setActivePage: (idx: number) => void;
  updatePage: (pageId: string, elements: any[]) => void;
  onRegisterTableActions?: (actions: TableActions | null) => void;
}

export function SpreadsheetApp({ doc, scale, activePage, setActivePage, updatePage, onRegisterTableActions }: SpreadsheetAppProps) {
  const [sheetStates, setSheetStates] = useState<Record<string, SheetRuntimeState>>({});

  const handleStateChange = React.useCallback((pageId: string, state: SheetRuntimeState) => {
    setSheetStates(prev => ({ ...prev, [pageId]: state }));
  }, []);

  const sheetNames = doc.metadata?.sheetNames || doc.pages.map((_, i) => `Sheet${i + 1}`);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, width: "100%", height: "100%", overflow: "hidden" }}>
      <WorkbookTabs 
        sheets={sheetNames} 
        activeSheet={activePage} 
        onTabChange={setActivePage} 
      />
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        {doc.pages[activePage] && (
          <SpreadsheetView
            key={doc.pages[activePage].id}
            page={doc.pages[activePage]}
            scale={scale}
            initialState={sheetStates[doc.pages[activePage].id]}
            onStateChange={handleStateChange}
            onUpdate={updatePage}
            onRegisterTableActions={onRegisterTableActions}
          />
        )}
      </div>
    </div>
  );
}
