import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Change before publishing; the id must be unique per store listing.
  appId: 'com.example.wanderaudio',
  appName: 'WanderAudio',
  webDir: 'dist',
  plugins: {
    // Routes fetch() through the phone's native HTTP stack: no CORS limits, and
    // OpenStreetMap services receive a proper User-Agent (see services/http.ts).
    CapacitorHttp: { enabled: true },
  },
};

export default config;
