import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.shrovetide.game',
  appName: 'Shrovetide',
  webDir: 'dist',
  backgroundColor: '#0d1f12',
  zoomEnabled: false,
  ios: {
    // Edge-to-edge WKWebView; CSS env(safe-area-inset-*) + viewport-fit=cover
    // keep HUD/pads off the notch. Desktop browsers treat those env() values as 0.
    contentInset: 'never',
    scrollEnabled: false,
    preferredContentMode: 'mobile',
    backgroundColor: '#0d1f12',
    allowsLinkPreview: false,
  },
};

export default config;
