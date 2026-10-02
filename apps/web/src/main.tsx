import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";
import "./style.css";
import { installLight } from "./fluent/light";

createRoot(document.getElementById("root")!).render(<App />);
installLight();
