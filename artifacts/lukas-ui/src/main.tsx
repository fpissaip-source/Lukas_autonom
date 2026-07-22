import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// Optionaler API-Token (wenn der Server mit LUKAS_API_TOKEN geschützt ist):
// wird über den Login-Screen (AuthGate) gesetzt, sobald er gebraucht wird.
setAuthTokenGetter(() => localStorage.getItem("lukas_token"));

createRoot(document.getElementById("root")!).render(<App />);
