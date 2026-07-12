import { parseExcel } from "./src/components/editors/utils/fileParsers";
import * as fs from "fs";

async function run() {
    // We don't have a real File object in node, but we can mock it
    const ab = new ArrayBuffer(0); // This will crash XLSX.read if empty, we need a real excel file
}
