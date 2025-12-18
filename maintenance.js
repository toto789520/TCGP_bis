// Immediately-run maintenance redirect. Included on pages to block when maintenance mode is enabled.
(function(){
  try {
    // Expose simple console helpers to allow a local client-only bypass.
    // Usage in the browser console:
    //   setMaintenanceBypass();            // enable bypass for this client (persisted in localStorage)
    //   setMaintenanceBypass(60000);      // enable bypass for 60 seconds
    //   clearMaintenanceBypass();          // remove bypass
    //   hasMaintenanceBypass();            // returns true/false
    // Short aliases available: setMB, clrMB, hasMB, smb, cbm
    window.setMaintenanceBypass = function(durationMs) {
      try {
        localStorage.setItem('maintenance_client_override', '1');
        console.info('Bypass de maintenance activé pour ce client');
        if (typeof durationMs === 'number' && durationMs > 0) {
          setTimeout(function(){
            try { localStorage.removeItem('maintenance_client_override'); console.info('Le bypass de maintenance a expiré et a été supprimé'); } catch(e){}
          }, durationMs);
        }
      } catch (e) { console.warn('Impossible d\'activer le bypass de maintenance', e); }
    };
    window.clearMaintenanceBypass = function() { try { localStorage.removeItem('maintenance_client_override'); console.info('Bypass de maintenance supprimé pour ce client'); } catch(e) { console.warn('Impossible de supprimer le bypass de maintenance', e); } };
    window.hasMaintenanceBypass = function() { try { return localStorage.getItem('maintenance_client_override') === '1'; } catch(e){ return false; } };

    // Short aliases for convenience
    try {
      window.setMB = window.setMaintenanceBypass;
      window.clrMB = window.clearMaintenanceBypass;
      window.hasMB = window.hasMaintenanceBypass;
      window.smb = window.setMaintenanceBypass;
      window.cbm = window.clearMaintenanceBypass;
    } catch (e) { /* ignore in restricted environments */ }

    // Check helpers
    window.isMaintenanceEnabled = function() {
      try { return window.maintenance === true; } catch (e) { return false; }
    };

    window.isMaintenanceBlocked = function() {
      try {
        // If maintenance not enabled, not blocked
        if (window.maintenance !== true) return false;

        // client override
        try { if (localStorage.getItem('maintenance_client_override') === '1') return false; } catch (e) {}

        // admin unlock via admin key
        try {
          var adminKey = (window.maintenanceAdminKey || '').toString();
          var stored = localStorage.getItem('maintenance_admin_unlocked');
          if (stored && adminKey && stored === adminKey) return false;
        } catch (e) {}

        return true;
      } catch (e) { return false; }
    };

    // Short alias
    try { window.isM = window.isMaintenanceBlocked; } catch (e) {}

    // Dynamic help: prints available maintenance console commands and usage
    window.maintenanceHelp = function() {
      var cmds = [
        {k: 'setMaintenanceBypass(durationMs?)', d: 'Active un contournement local pour ce client (persisté dans localStorage). Durée optionnelle en ms.'},
        {k: 'clearMaintenanceBypass()', d: 'Supprime le contournement client.'},
        {k: 'hasMaintenanceBypass()', d: 'Renvoie true si le contournement client est actif.'},
        {k: 'setMB / smb(durationMs?)', d: 'Alias de setMaintenanceBypass.'},
        {k: 'clrMB / cbm()', d: 'Alias de clearMaintenanceBypass.'},
        {k: 'hasMB()', d: 'Alias de hasMaintenanceBypass.'},
        {k: 'isMaintenanceEnabled()', d: 'Renvoie true si le mode maintenance est activé dans la configuration.'},
        {k: 'isMaintenanceBlocked() / isM()', d: 'Renvoie true si ce client serait bloqué (tient compte des contournements et de la clé admin).'},
        {k: 'maintenanceAdminKey (config)', d: 'Défini dans maintenance-config.js pour permettre le déverrouillage admin via ?maintenance_key=CLE'},
        {k: 'Use admin URL', d: 'Visitez n\'importe quelle page avec ?maintenance_key=CLE pour déverrouiller l\'admin (si configuré).'}
      ];
      console.group('%cAide maintenance', 'color: var(--secondary); font-weight:700');
      cmds.forEach(function(item){
        console.log('%c' + item.k, 'color: #9fb4ff; font-weight:600', '-', item.d);
      });
      console.log('Exemple : setMB(60000) — active le bypass pendant 60s');
      console.groupEnd();
      return cmds;
    };
    try { window.mh = window.maintenanceHelp; window.helpM = window.maintenanceHelp; } catch(e){}

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

    // Client-only override (console/localStorage). If present, allow this client.
    try {
      if (localStorage.getItem('maintenance_client_override') === '1') {
        console.info('Maintenance: client override active (local) — allowing access');
        return;
      }
    } catch (e) {}

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
    console.warn('Vérification de maintenance échouée', e);
  }
})();
