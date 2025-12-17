/**
 * @file Application entry point for the Office Bingos frontend.
 */

import { initializeApp } from "./app";
import { clearQueryHints, parseQueryHints } from "./routing";

const hints = parseQueryHints();
initializeApp(hints);
clearQueryHints();
