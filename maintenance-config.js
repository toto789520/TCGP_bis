// Toggle maintenance mode for the site.
// Set to true to activate maintenance and block the site (including admin).
// Example: open this file and change false → true when needed.
window.maintenance = true;

// Optional admin bypass key. If set (non-empty string), an admin can unlock
// maintenance mode by visiting any page with ?maintenance_key=THE_KEY.
// The key will be remembered in localStorage as maintenance_admin_unlocked.
// Leave empty to disable the bypass.
window.maintenanceAdminKey = '';

