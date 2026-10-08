import { createRoot } from "react-dom/client";
import App from "./app/App";
import { ThemeProvider } from "./app/theme";
import ErrorBoundary from "./components/ui/ErrorBoundary";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <ThemeProvider>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </ThemeProvider>,
);
