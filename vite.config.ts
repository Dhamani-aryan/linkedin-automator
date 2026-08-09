import { spawn, type ChildProcess } from "node:child_process";
import { defineConfig } from "vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

function localControllerPlugin(): Plugin {
  let controller: ChildProcess | null = null;

  return {
    name: "linkedin-automator-local-controller",
    apply: "serve",
    configureServer(server) {
      controller = spawn(process.execPath, ["server/index.js"], {
        cwd: process.cwd(),
        env: process.env,
        stdio: "inherit",
        windowsHide: true
      });

      controller.once("exit", (code) => {
        if (code && code !== 0) {
          server.config.logger.error(`Local Chrome controller stopped with exit code ${code}.`);
        }
        controller = null;
      });

      server.httpServer?.once("close", () => {
        controller?.kill();
        controller = null;
      });
    }
  };
}

export default defineConfig(({ command, mode }) => ({
  plugins: [
    react(),
    ...(command === "serve" && mode !== "test" ? [localControllerPlugin()] : [])
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4287"
    }
  }
}));
