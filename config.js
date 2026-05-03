// No API keys required — basemap is CartoDB Dark Matter (free), radar is
// Iowa Environmental Mesonet (free), warnings are NWS api.weather.gov (free).

// Starting view ([lat, lng] for Leaflet)
export const INITIAL_VIEW = {
  center: [32.4, -90.5], // Mississippi (severe weather alley)
  zoom: 6.25,
};

// Radar animation
export const FRAME_COUNT = 12;          // number of frames in the loop
export const FRAME_INTERVAL_MIN = 5;    // minutes between frames (NEXRAD MRMS = 5 min)
export const FRAME_PLAYBACK_MS = 600;   // ms per frame during playback
export const LAST_FRAME_HOLD_MS = 1200; // pause on the most recent frame
export const RADAR_OPACITY = 0.78;
