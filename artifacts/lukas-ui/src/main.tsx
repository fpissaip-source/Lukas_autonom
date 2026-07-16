import { createRoot } from "react-dom/client";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

// Optionaler API-Token (wenn der Server mit LUKAS_API_TOKEN geschützt ist):
// im Browser einmalig setzen mit localStorage.setItem("lukas_token", "<token>")
setAuthTokenGetter(() => localStorage.getItem("lukas_token"));

createRoot(document.getElementById("root")!).render(<App />);
