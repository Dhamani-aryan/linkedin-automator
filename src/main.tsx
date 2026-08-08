import React from "react";
import ReactDOM from "react-dom/client";
import { Theme } from "@radix-ui/themes";
import { App } from "./App";
import "@fontsource-variable/plus-jakarta-sans";
import "@radix-ui/themes/styles.css";
import "./styles.css";
import "./design-system.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Theme
      appearance="dark"
      accentColor="blue"
      grayColor="gray"
      panelBackground="solid"
      radius="medium"
      scaling="100%"
    >
      <App />
    </Theme>
  </React.StrictMode>
);
