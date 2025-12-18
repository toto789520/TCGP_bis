// Immediately-run maintenance redirect. Included on pages to block when maintenance mode is enabled.
(function(){
  try {
    var path = window.location.pathname.split('/').pop();

    // If maintenance is not enabled, do nothing.
    if (window.maintenance !== true) return;

    // If we're already on the maintenance page, do nothing.
    if (path === 'maintenance.html') return;

    // Admin bypass handling via a secret key stored in maintenance-config.js
    var params = new URLSearchParams(window.location.search || '');
    var keyParam = params.get('maintenance_key') || params.get('maintenanceKey') || params.get('maintenance-key');
    var adminKey = (window.maintenanceAdminKey || '').toString();
    var unlocked = false;

    try {
      var stored = localStorage.getItem('maintenance_admin_unlocked');
      if (stored && adminKey && stored === adminKey) unlocked = true;
    } catch (e) {}

    if (!unlocked && adminKey && keyParam && keyParam === adminKey) {
      try {
        localStorage.setItem('maintenance_admin_unlocked', adminKey);
      } catch (e) {}
      // Remove the key from the URL without reloading the page
      params.delete('maintenance_key'); params.delete('maintenanceKey'); params.delete('maintenance-key');
      var newUrl = window.location.pathname + (params.toString() ? ('?' + params.toString()) : '') + window.location.hash;
      history.replaceState(null, '', newUrl);
      unlocked = true;
    }

    // If unlocked, allow access (no redirect).
    if (unlocked) return;

    // Otherwise redirect to maintenance page.
    window.location.replace('maintenance.html');
  } catch (e) {
    console.warn('Maintenance check failed', e);
  }
})();
