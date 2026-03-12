import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import LoginGate from "./components/LoginGate";
import { ThemeProvider } from "./ThemeContext";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ErrorBoundary>
        <LoginGate>
          <App />
        </LoginGate>
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
);
