// Set your Mapbox public token here. Create one at https://account.mapbox.com
// (The default below is a placeholder and will not render tiles.)
export const MAPBOX_TOKEN = "pk.REPLACE_WITH_YOUR_MAPBOX_PUBLIC_TOKEN";

// Optional: starting view
export const INITIAL_VIEW = {
  center: [-90.5, 32.4], // Mississippi (severe weather alley)
  zoom: 6.2,
};

// Radar animation
export const FRAME_COUNT = 12;          // number of frames in the loop
export const FRAME_INTERVAL_MIN = 5;    // minutes between frames (NEXRAD MRMS = 5 min)
export const FRAME_PLAYBACK_MS = 600;   // ms per frame during playback
export const LAST_FRAME_HOLD_MS = 1200; // pause on the most recent frame
export const RADAR_OPACITY = 0.78;
