import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";
import "./style.css";
import "./ui/freedom.css";
import { installLight } from "./fluent/light";
import { restoreAppearance } from "./appearance";

// ST-160: the last theme, size and contrast of this browser apply before the first paint; the session confirms them.
restoreAppearance();
createRoot(document.getElementById("root")!).render(<App />);
installLight();
