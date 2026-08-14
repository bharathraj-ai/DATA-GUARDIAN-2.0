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
  onRenameTab?: (idx: number) => void;
  hideTabs?: boolean;
}

export function SpreadsheetApp({ doc, scale, activePage, setActivePage, updatePage, onRegisterTableActions, onRenameTab, hideTabs }: SpreadsheetAppProps) {
  const [sheetStates, setSheetStates] = useState<Record<string, SheetRuntimeState>>({});

  const handleStateChange = React.useCallback((pageId: string, state: SheetRuntimeState) => {
    setSheetStates(prev => ({ ...prev, [pageId]: state }));
  }, []);

  const sheetNames = doc.pages.map((p, i) => p.title || doc.metadata?.sheetNames?.[i] || `Sheet${i + 1}`);

  return (
    <div className="spreadsheet-app" style={{ display: "flex", flexDirection: "column", flex: 1, width: "100%", height: "100%", overflow: "hidden", minWidth: 0 }}>
      {!hideTabs && (
        <WorkbookTabs
          sheets={sheetNames}
          activeSheet={activePage}
          onTabChange={setActivePage}
          onTabDoubleClick={onRenameTab}
        />
      )}
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
