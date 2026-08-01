// Default frontend config, used when Flask serves the site directly.
// The Netlify build overwrites this file with a generated version that records
// the build time, commit and whether BACKEND_URL was configured
// (see tools/build_static.py).
window.MBPP_CONFIG = {
  apiBase: "/api/v1",
  backendConfigured: true,
  static: false
};
