// Planted bug #3: `analytics` was never loaded, so this throws on every landing page load.
window.analytics.track("page_view");
