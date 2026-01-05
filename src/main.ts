/**
 * @file Application entry point for the Office Bingos frontend.
 */

import { initializeApp } from "./app";
import { initializeNewBoardApp } from "./new-board";
import { clearQueryHints, parseQueryHints } from "./routing";

const hints = parseQueryHints();
const mode = document.body?.dataset.appMode === "create" ? "create" : "view";

if (mode === "create") {
	initializeNewBoardApp(hints);
} else {
	initializeApp(hints);
}
clearQueryHints();
