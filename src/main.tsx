import { createRoot } from "react-dom/client";
import App from "./app/App";
import { ThemeProvider } from "./app/theme";
import ErrorBoundary from "./components/ui/ErrorBoundary";
import { TooltipProvider } from "./components/ui/Tooltip";
import "./styles/shadcn.css";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <ErrorBoundary>
      <TooltipProvider delayDuration={400} skipDelayDuration={100}>
        <App />
      </TooltipProvider>
    </ErrorBoundary>
  </ThemeProvider>,
);
