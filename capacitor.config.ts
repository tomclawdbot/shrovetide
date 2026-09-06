import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.shrovetide.game',
  appName: 'Shrovetide',
  webDir: 'dist',
  ios: {
    // Let the web layer paint under the notch / home indicator; index.html
    // already pads with env(safe-area-inset-*) and the viewport is
    // viewport-fit=cover.
    contentInset: 'never',
    backgroundColor: '#0d1f12',
  },
  server: {
    // Standard for a bundled offline app.
    androidScheme: 'https',
  },
};

export default config;
