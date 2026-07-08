import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import "./index.css";
import { loadRuntimeConfig } from "./lib/config";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

// Load runtime config before rendering
async function bootstrap() {
  try {
    const config = await loadRuntimeConfig();
    // Store config in module singleton for axios interceptor access
    const { setRuntimeConfig } = await import("./lib/config");
    setRuntimeConfig(config);
  } catch (error) {
    console.error("Failed to load runtime config:", error);
  }

  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error('Missing root element with id "root"');
  }

  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
        <Toaster
          position="top-right"
          richColors
          closeButton
          expand
          toastOptions={{ duration: 5000 }}
        />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

void bootstrap();
