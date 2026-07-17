import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "dev.aico8.research",
  appName: "Aico 8 Research",
  webDir: "www",
  android: {
    allowMixedContent: false,
    backgroundColor: "#071426",
    webContentsDebuggingEnabled: false,
  },
};

export default config;
