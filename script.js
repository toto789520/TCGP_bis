import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_CONFIG } from './supabase-config.js';

// --- SYSTÈME DE LOGGING ---
const Logger = {
    logs: [],
    maxLogs: 100,
    maxStoredLogs: 50,
    enabled: false, // Désactiver par défaut en production
    
    log(level, message, data = null) {
        if (!this.enabled) return; // Ne rien faire si désactivé
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            data,
            userAgent: navigator.userAgent,
            url: window.location.href
        };
        
        this.logs.push(logEntry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
        
        // Console output avec couleur
        const styles = {
            info: 'color: #4CAF50',
            warn: 'color: #FF9800',
            error: 'color: #f44336',
            debug: 'color: #2196F3'
        };
        console.log(`%c[${level.toUpperCase()}] ${timestamp}: ${message}`, styles[level] || '', data || '');
        
        // Stocker dans localStorage pour persistance
        try {
            localStorage.setItem('app_logs', JSON.stringify(this.logs.slice(-this.maxStoredLogs)));
        } catch (e) {
            console.warn('Impossible de sauvegarder les logs dans localStorage:', e.message);
        }
    },
    
    info(message, data) { this.log('info', message, data); },
    warn(message, data) { this.log('warn', message, data); },
    error(message, data) { this.log('error', message, data); },
    debug(message, data) { this.log('debug', message, data); },
    
    getLogs() { return this.logs; },
    
    clearLogs() { 
        this.logs = []; 
        localStorage.removeItem('app_logs');
    }
};

// --- FIRESTORE WRITE BUFFER FOR BOOSTER REVEALS ---
// Reduce write frequency by buffering revealed indices and flushing with debounce
let _pendingRevealed = null; // array of indices to save (shared for current open booster)
let _saveBoosterTimer = null;
const BOOSTER_SAVE_DEBOUNCE_MS = 5000; // flush after 5s of inactivity

async function _flushPendingRevealed(uid) {
    if (!uid || !_pendingRevealed || _pendingRevealed.length === 0) return;
    const toSave = Array.from(new Set(_pendingRevealed)).sort((a,b)=>a-b);
    _pendingRevealed = null;
    clearTimeout(_saveBoosterTimer);
    _saveBoosterTimer = null;
    try {
        await safeSetPlayerDoc(uid, { booster_revealed_cards: toSave }, { merge: true });
    } catch (e) {
        console.error('Erreur sauvegarde (batch) révélation:', e);
    }
}

function _scheduleSaveRevealed(uid) {
    if (!uid) return;
    if (!_saveBoosterTimer) {
        _saveBoosterTimer = setTimeout(() => _flushPendingRevealed(uid), BOOSTER_SAVE_DEBOUNCE_MS);
    } else {
        clearTimeout(_saveBoosterTimer);
        _saveBoosterTimer = setTimeout(() => _flushPendingRevealed(uid), BOOSTER_SAVE_DEBOUNCE_MS);
    }
}

// --- GENERIC PLAYER WRITE QUEUE (for resource-exhausted handling) ---
const PLAYER_WRITE_QUEUE_KEY = 'player_write_queue_v1';
let _playerWriteQueueTimer = null;
const PLAYER_QUEUE_FLUSH_INTERVAL_MS = 30000; // try every 30s when items present

function _readPlayerWriteQueue() {
    try {
        const raw = localStorage.getItem(PLAYER_WRITE_QUEUE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch (e) {
        console.error('Erreur lecture queue localStorage', e);
        return [];
    }
}

function _writePlayerWriteQueue(queue) {
    try {
        localStorage.setItem(PLAYER_WRITE_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
        console.error('Erreur écriture queue localStorage', e);
    }
}

function _enqueuePlayerWrite(uid, data, options = {}) {
    const queue = _readPlayerWriteQueue();
    queue.push({ uid, data, options, attempts: 0, createdAt: Date.now() });
    _writePlayerWriteQueue(queue);
    _schedulePlayerQueueFlush();
}

// Enqueue a collection-add operation that can be merged client-side to avoid
// creating many separate writes for the same user. Items should be plain JS objects.
function _enqueueCollectionAdd(uid, items = []) {
    if (!Array.isArray(items) || items.length === 0) return;
    const queue = _readPlayerWriteQueue();
    // Try to find existing addToCollection for same uid and merge
    let found = false;
    for (let entry of queue) {
        if (entry && entry.uid === uid && entry.op === 'addToCollection') {
            entry.items = (entry.items || []).concat(items);
            entry.createdAt = Math.min(entry.createdAt || Date.now(), Date.now());
            found = true;
            break;
        }
    }
    if (!found) {
        queue.push({ uid, op: 'addToCollection', items: items.slice(), attempts: 0, createdAt: Date.now() });
    }
    _writePlayerWriteQueue(queue);
    _schedulePlayerQueueFlush();
}

function _schedulePlayerQueueFlush(delay = PLAYER_QUEUE_FLUSH_INTERVAL_MS) {
    if (_playerWriteQueueTimer) return; // already scheduled
    _playerWriteQueueTimer = setTimeout(async () => {
        _playerWriteQueueTimer = null;
        await _processPlayerWriteQueue();
    }, delay);
}

async function _processPlayerWriteQueue() {
    let queue = _readPlayerWriteQueue();
    if (!queue || queue.length === 0) return;
    // Try to process items sequentially
    let changed = false;
    for (let i = 0; i < queue.length; ) {
        const item = queue[i];
        try {
            if (item && item.op === 'addToCollection') {
                // Convert queued addToCollection into an arrayUnion write
                let items = item.items || [];
                if (items.length > 0) {
                    // Deduplicate by `id` when possible to avoid duplicate card writes
                    try {
                        const deduped = Array.from(new Map(items.map(c => [c && c.id ? c.id : JSON.stringify(c), c])).values());
                        items = deduped;
                    } catch (er) { /* fallback: use original items */ }
                    await arrayUnionUpdate(item.uid, 'collection', items);
                }
            } else {
                await setPlayerDoc(item.uid, item.data, item.options || { merge: true });
            }
            // success -> remove this item
            queue.splice(i, 1);
            changed = true;
            // continue without incrementing i
        } catch (e) {
            console.error('Erreur lors du flush de la queue joueur:', e);
            item.attempts = (item.attempts || 0) + 1;
            // If quota error, stop processing now and retry later with backoff
            const isQuota = (e && e.code && e.code === 'resource-exhausted') || (e && typeof e.message === 'string' && e.message.toLowerCase().includes('quota'));
            if (isQuota) {
                // save modified queue and schedule retry with exponential backoff
                _writePlayerWriteQueue(queue);
                const backoff = Math.min(60000, 10000 * Math.pow(2, Math.min(6, item.attempts)));
                _schedulePlayerQueueFlush(backoff);
                return;
            } else {
                // Non-quota error: drop this item after many attempts
                if (item.attempts > 3) {
                    console.warn('Abandon write après plusieurs échecs:', item);
                    queue.splice(i, 1);
                    changed = true;
                } else {
                    // try next item
                    i++;
                }
            }
        }
    }
    if (changed) _writePlayerWriteQueue(queue);
}

async function safeSetPlayerDoc(uid, data, options = { merge: true }) {
    try {
        // Simple per-user rate limiter to avoid immediate write bursts from UI
        if (!window._lastPlayerWriteAt) window._lastPlayerWriteAt = {};
        const MIN_WRITE_INTERVAL_MS = 1000; // 1s per-user minimum
        const last = window._lastPlayerWriteAt[uid] || 0;
        const now = Date.now();
        if (now - last < MIN_WRITE_INTERVAL_MS) {
            // enqueue instead of immediate write to avoid bursts
            _enqueuePlayerWrite(uid, data, options);
            return;
        }

        await setPlayerDoc(uid, data, options);
        window._lastPlayerWriteAt[uid] = Date.now();
    } catch (e) {
        const isQuota = (e && e.code && e.code === 'resource-exhausted') || (e && typeof e.message === 'string' && e.message.toLowerCase().includes('quota'));
        if (isQuota) {
            console.warn('Quota dépassé — mise en file d\'attente de l\'écriture', { uid, data });
            _enqueuePlayerWrite(uid, data, options);
        } else {
            // rethrow for other handlers
            throw e;
        }
    }
}

// Charger les logs depuis localStorage au démarrage
try {
    const savedLogs = localStorage.getItem('app_logs');
    if (savedLogs) {
        Logger.logs = JSON.parse(savedLogs);
    }
} catch (e) {
    console.error('Erreur chargement logs:', e);
}

// Capturer les erreurs globales
window.addEventListener('error', (event) => {
    Logger.error('Erreur JavaScript non gérée', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error?.stack
    });
});

window.addEventListener('unhandledrejection', (event) => {
    Logger.error('Promise non gérée', {
        reason: event.reason,
        promise: event.promise
    });
});

// Exposer Logger globalement pour debugging
window.Logger = Logger;

// --- DÉTECTION D'APPAREIL ET NAVIGATEUR ---
const DeviceInfo = {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream,
    // iPad detection: combine multiple signals for reliability
    // Note: Modern iPads may report as MacIntel, so we check maxTouchPoints
    isIPad: /iPad/.test(navigator.userAgent) || 
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ||
            (navigator.userAgentData && navigator.userAgentData.platform === 'macOS' && navigator.maxTouchPoints > 1),
    isAndroid: /Android/.test(navigator.userAgent),
    isMobile: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
    isSafari: /^((?!chrome|android).)*safari/i.test(navigator.userAgent),
    isChrome: /Chrome/.test(navigator.userAgent) && /Google Inc/.test(navigator.vendor),
    isFirefox: /Firefox/.test(navigator.userAgent),
    isSamsung: /SamsungBrowser/.test(navigator.userAgent),
    // Problematic browsers detection (including X/Twitter)
    isInAppBrowser: /FBAN|FBAV|Instagram|Line|Snapchat|Twitter|X;|WeChat/i.test(navigator.userAgent),
    isCometBrowser: /Comet/i.test(navigator.userAgent),
    
    get isProblematicBrowser() {
        return this.isInAppBrowser || this.isCometBrowser;
    },
    
    get info() {
        return {
            userAgent: this.userAgent,
            platform: this.platform,
            isIOS: this.isIOS,
            isIPad: this.isIPad,
            isAndroid: this.isAndroid,
            isMobile: this.isMobile,
            isSafari: this.isSafari,
            isChrome: this.isChrome,
            isFirefox: this.isFirefox,
            isSamsung: this.isSamsung,
            isInAppBrowser: this.isInAppBrowser,
            isCometBrowser: this.isCometBrowser,
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
            viewport: {
                width: window.innerWidth,
                height: window.innerHeight
            }
        };
    }
};

// Logger les infos de l'appareil au chargement
Logger.info('Appareil détecté', DeviceInfo.info);

// Exposer DeviceInfo globalement pour debugging
window.DeviceInfo = DeviceInfo;

// --- URL STATE HELPERS ---
function readUrlParams() {
    return new URLSearchParams(window.location.search);
}

function applyUrlState() {
    const params = readUrlParams();
    const gen = params.get('gen');
    const q = params.get('q');
    const s = params.get('s');
    const rarity = params.get('rarity');
    const booster = params.get('booster');
    const adminPreview = params.get('admin_preview');

    const genSelect = document.getElementById('gen-select');
    if (genSelect && gen) genSelect.value = gen;
    const packQty = document.getElementById('pack-quantity');
    if (packQty && q) packQty.value = q;
    const searchInput = document.getElementById('search-input');
    if (searchInput && s !== null) searchInput.value = s;
    // Do not persist owned/missing in URL per user request

    // Admin preview (show all) - only meaningful if the control exists
    const adminPreviewEl = document.getElementById('admin-show-all');
    if (adminPreviewEl && adminPreview !== null) {
        adminPreviewEl.checked = (adminPreview === '1' || adminPreview === 'true');
        window.adminShowAllMode = adminPreviewEl.checked;
    }

    // Apply rarity filter (may be invalid for some gens; will be validated after gen loads)
    window.selectedRarityFilter = rarity ? rarity : null;

    // Booster open flag
    window._openBoosterViaUrl = (booster === '1');
}

function pushUrlState(replace = true) {
    try {
        const params = readUrlParams();
        const genSelect = document.getElementById('gen-select');
        if (genSelect) params.set('gen', genSelect.value);
        const packQty = document.getElementById('pack-quantity');
        if (packQty) params.set('q', packQty.value);
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            const v = searchInput.value.trim();
            if (v) params.set('s', v); else params.delete('s');
        }
        // Do not include owned/missing in URL per user request
        // admin preview flag
        if (window.adminShowAllMode) params.set('admin_preview', '1'); else params.delete('admin_preview');
        if (window.selectedRarityFilter) params.set('rarity', window.selectedRarityFilter); else params.delete('rarity');
        if (window._openBooster) params.set('booster', '1'); else params.delete('booster');

        const newUrl = window.location.pathname + (params.toString() ? ('?' + params.toString()) : '');
        if (replace) history.replaceState(null, '', newUrl); else history.pushState(null, '', newUrl);
    } catch (e) {
        console.warn('pushUrlState failed', e);
    }
}

// PWA installation support removed per request

// --- 1. CONFIGURATION ---
const ADMIN_EMAIL = "bryan.drouet24@gmail.com";
const COOLDOWN_MINUTES = 7;
const VIP_COOLDOWN_MINUTES = 4; // cooldown spécifique pour les VIP
const PACKS_PER_COOLDOWN = 3;
const POINTS_PER_CARD = 1;
const POINTS_FOR_BONUS_PACK = 30;
const BOOSTER_DELAY_SECONDS = 3;
const AUTH_LOADING_TIMEOUT_MS = 10000; // 10 secondes max pour l'authentification

// SUPABASE CONFIG
const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

// Supabase error codes
const SUPABASE_ERROR_NOT_FOUND = 'PGRST116'; // PostgreSQL REST error: row not found

// Supabase database helpers
async function getPlayerDoc(uid) {
    const { data, error } = await supabase
        .from('players')
        .select('*')
        .eq('user_id', uid)
        .single();
    
    if (error && error.code !== SUPABASE_ERROR_NOT_FOUND) {
        console.error('Error fetching player for uid:', uid, error);
        throw error;
    }
    
    return {
        exists: () => !!data,
        data: () => data || {}
    };
}

async function setPlayerDoc(uid, updates, options = {}) {
    let result;
    
    if (options.merge) {
        // Only fetch existing data if merge is needed
        const { data: existingData } = await supabase
            .from('players')
            .select('*')
            .eq('user_id', uid)
            .single();
        
        if (existingData) {
            // Update existing record with merged data
            const mergedData = { ...existingData, ...updates };
            result = await supabase
                .from('players')
                .update(mergedData)
                .eq('user_id', uid);
        } else {
            // Insert new record
            result = await supabase
                .from('players')
                .insert({ ...updates, user_id: uid });
        }
    } else {
        // Try to update first without fetching
        result = await supabase
            .from('players')
            .update(updates)
            .eq('user_id', uid);
        
        // If no rows updated, try to insert
        if (result.status === 200 && result.statusText === 'OK' && !result.error) {
            // Check if update actually affected rows by trying to fetch
            const { data: check } = await supabase
                .from('players')
                .select('id')
                .eq('user_id', uid)
                .single();
            
            if (!check) {
                // No existing record, insert new one
                result = await supabase
                    .from('players')
                    .insert({ ...updates, user_id: uid });
            }
        }
    }
    
    if (result.error) {
        console.error('Error setting player doc:', result.error);
        throw result.error;
    }
    
    return result;
}

async function updatePlayerDoc(uid, updates) {
    const { error } = await supabase
        .from('players')
        .update(updates)
        .eq('user_id', uid);
    
    if (error) {
        console.error('Error updating player:', error);
        throw error;
    }
}

async function deletePlayerDoc(uid) {
    const { error } = await supabase
        .from('players')
        .delete()
        .eq('user_id', uid);
    
    if (error) {
        console.error('Error deleting player:', error);
        throw error;
    }
}

async function deleteSessionDoc(uid) {
    const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('user_id', uid);
    
    if (error) {
        console.error('Error deleting session:', error);
        throw error;
    }
}

async function getAllPlayers() {
    const { data, error } = await supabase
        .from('players')
        .select('*')
        .order('created_at', { ascending: false });
    
    if (error) {
        console.error('Error fetching all players:', error);
        throw error;
    }
    
    return data || [];
}

// Helper to add items to array in JSONB column
async function arrayUnionUpdate(uid, field, items) {
    const { data: currentData } = await supabase
        .from('players')
        .select(field)
        .eq('user_id', uid)
        .single();
    
    if (!currentData) return;
    
    const currentArray = currentData[field] || [];
    const newArray = [...currentArray, ...items];
    
    const { error } = await supabase
        .from('players')
        .update({ [field]: newArray })
        .eq('user_id', uid);
    
    if (error) {
        console.error(`Error updating ${field}:`, error);
        throw error;
    }
}

// Try to flush any queued player writes from previous sessions
try {
    _processPlayerWriteQueue().catch(e => console.warn('Erreur flush queue au démarrage:', e));
} catch (e) {
    console.warn('Impossible de lancer le flush de la queue au démarrage', e);
}

// Sur iOS/iPad, utiliser la persistance locale pour éviter les problèmes avec ITP
if (DeviceInfo.isIOS || DeviceInfo.isIPad) {
    Logger.info('iOS/iPad détecté - Configuration de la persistance auth');
}

// Vérifier les résultats de redirection au chargement (Google OAuth)
supabase.auth.getSession().then(async ({ data }) => {
    if (data.session && data.session.provider_token) {
        Logger.info('Connexion Google par redirection réussie');
    }
}).catch((error) => {
    Logger.error('Erreur lors de la récupération de la session', {
        message: error.message
    });
    
    const authMsg = document.getElementById('auth-msg');
    if (authMsg) {
        authMsg.style.color = '#ff6b6b';
        authMsg.innerHTML = '<img src="assets/icons/triangle-alert.svg" class="icon-inline" alt="warn"> Erreur de connexion: ' + error.message;
    }
});

// --- GESTION INSTANCE UNIQUE ---
const SESSION_ID = Date.now() + '_' + Math.random().toString(36) + '_' + performance.now();
let sessionCheckInterval = null;
let isBlocked = false;

async function checkSingleInstance(userId) {
    // Désactivé pour éviter les erreurs de permissions
    return true;
}

async function startSessionMonitoring(userId) {
    // Désactivé pour éviter les erreurs de permissions
    return true;
}

// Liste des Générations
const GEN_LIST = [
    { id: "gen1", name: "Gen 1 - Kanto" },
    { id: "gen2", name: "Gen 2 - Johto" },
    { id: "gen3", name: "Gen 3 - Hoenn" },
    { id: "gen4", name: "Gen 4 - Sinnoh" },
    { id: "gen5", name: "Gen 5 - Unys" },
    { id: "gen6", name: "Gen 6 - Kalos" },
    { id: "gen7", name: "Gen 7 - Alola" },
    { id: "special_bryan", name: "Pack Spécial Bryan" }
];

const GAME_CONFIG = {
    dropRates: [
        { type: 'common',     chance: 56,  filename: 'common.json', label: "Commune", weight: 1 },
        { type: 'uncommon',   chance: 26,  filename: 'uncommon.json', label: "Peu Com.", weight: 2 },
        { type: 'rare',       chance: 14,  filename: 'rare.json', label: "Rare", weight: 3 },
        { type: 'ultra_rare', chance: 3.8, filename: 'ultra_rare.json', label: "Ultra Rare", weight: 4 },
        { type: 'secret',     chance: 0.2, filename: 'secret.json', label: "SECRÈTE", weight: 5 }
    ],
    dropRatesSixthCard: [ // Pour la 5ème carte : possibilité de secrète mais pas de commune/uncommon
        { type: 'rare',       chance: 68,  filename: 'rare.json', label: "Rare", weight: 3 },
        { type: 'ultra_rare', chance: 30,  filename: 'ultra_rare.json', label: "Ultra Rare", weight: 4 },
        { type: 'secret',     chance: 2,   filename: 'secret.json', label: "SECRÈTE", weight: 5 }
    ],
    // Icônes (Noms simplifiés en minuscules comme demandé)
    icons: {
        Fire: 'icons/fire.svg', Water: 'icons/water.svg', Grass: 'icons/grass.svg',
        Electric: 'icons/electric.svg', Psychic: 'icons/psychic.svg', Fighting: 'icons/fighting.svg',
        Darkness: 'icons/dark.svg', Metal: 'icons/steel.svg', Fairy: 'icons/fairy.svg',
        Dragon: 'icons/dragon.svg', Ice: 'icons/ice.svg', Ground: 'icons/ground.svg',
        Flying: 'icons/flying.svg', Bug: 'icons/bug.svg', Rock: 'icons/rock.svg',
        Ghost: 'icons/ghost.svg', Poison: 'icons/poison.svg', Normal: 'icons/normal.svg',
        Colorless: 'icons/normal.svg'
    }
};

// --- VARIABLES GLOBALES (Cruciales pour éviter les erreurs "undefined") ---
let userCollection = []; // Cartes possédées par le joueur
let currentGenData = []; // Toutes les cartes possibles de la gen active
let cooldownInterval = null;
let tempBoosterCards = []; // Cartes en cours d'ouverture
let adminShowAllMode = false; // Mode admin pour afficher toutes les cartes
let selectedRarityFilter = null; // Filtre de rareté actif

// --- INITIALISATION AU CHARGEMENT DE LA PAGE ---
window.onload = () => {
    // Vérifier si on est dans un environnement problématique (warning removed)
    if (DeviceInfo.isProblematicBrowser) {
        Logger.warn('Navigateur problématique détecté', { 
            userAgent: navigator.userAgent,
            isCometBrowser: DeviceInfo.isCometBrowser,
            isInAppBrowser: DeviceInfo.isInAppBrowser
        });
        // No UI warning inserted per user request; optionally display a subtle note elsewhere if needed
    }
    
    // Initialiser les options de génération
    const select = document.getElementById('gen-select');
    if(select) {
        // On inverse la liste pour avoir Gen 7 en premier
        [...GEN_LIST].reverse().forEach(gen => {
            const opt = document.createElement('option');
            opt.value = gen.id;
            opt.innerText = gen.name;
            select.appendChild(opt);
        });
    }
};

// --- GESTION POPUP ---
window.showPopup = (title, msg) => {
    const el = document.getElementById('custom-popup-overlay');
    if(el) {
        document.getElementById('popup-title').innerText = title;
        // Utiliser innerHTML pour supporter le formatage HTML
        // Utiliser popup-content si disponible, sinon popup-msg pour compatibilité
        const msgEl = document.getElementById('popup-content') || document.getElementById('popup-msg');
        // Ne pas remplacer les sauts de ligne par des <br> — laisser le rendu natif (white-space: pre-line)
        msgEl.innerHTML = msg;
        msgEl.style.textAlign = 'left';
        el.style.display = 'flex';
    } else {
        alert(title + "\n" + msg.replace(/<[^>]*>/g, ''));
    }
};
window.closePopup = () => { 
    const el = document.getElementById('custom-popup-overlay');
    if(el) el.style.display = 'none'; 
};

// Affiche un message d'authentification stylisé dans le popup
window.showAuthStatusPopup = (statusText = 'Connexion en cours...') => {
    const html = `
        <p id="auth-msg" class="auth-msg">${statusText}</p>
        <p class="auth-note">Les VIPs ont un cooldown de <strong>4 minutes</strong>.</p>
        <div style="display:flex; justify-content:flex-end;">
            <button class="btn-tertiary popup-action-btn" onclick="closePopup();"><img src="assets/icons/arrow-left-from-line.svg" class="icon-inline" alt="back"> Retour au Jeu</button>
        </div>
    `;
    window.showPopup('Connexion', html);
};

// --- MENU PROFIL ---
function showProfileMenu() {
    const menuHtml = `
        <div style="display: flex; flex-direction: column; gap: 15px;">
            <button onclick="logout()" class="btn-secondary" style="width: 100%;"><img src="assets/icons/log-out.svg" class="icon-inline" alt="logout"> Déconnexion
            </button>
            <button onclick="resetAccount()" class="btn-secondary" style="width: 100%;"><img src="assets/icons/refresh-ccw.svg" class="icon-inline" alt="reset"> Réinitialiser mon compte
            </button>
            <button onclick="deleteAccount()" class="btn-tertiary" style="width: 100%; background: var(--danger); border-color: #a82929; box-shadow: 0 4px 0 #a82929;"><img src="assets/icons/x.svg" class="icon-inline" alt="delete"> Supprimer mon compte
            </button>
        </div>
    `;
    
    const popup = document.getElementById('custom-popup-overlay');
    const title = document.getElementById('popup-title');
    const msg = document.getElementById('popup-content') || document.getElementById('popup-msg');
    
    title.innerHTML = "<img src=\"assets/icons/user.svg\" class=\"icon-inline\" alt=\"user\"> MON PROFIL";
    msg.innerHTML = menuHtml;
    popup.style.display = 'flex';
}

// Ajuste les pourcentages de drop pour les VIP (favorise rare/ultra/secret)
function adjustRatesForVip(rates) {
    // Multiplicateurs par rareté
    const mult = {
        'common': 0.8,
        'uncommon': 0.9,
        'rare': 1.2,
        'ultra_rare': 1.4,
        'secret': 1.6
    };
    // Copier et appliquer
    const adjusted = rates.map(r => ({ ...r, chance: (r.chance || 0) * (mult[r.type] || 1) }));
    // Normaliser pour que la somme soit identique (ou 100)
    const sum = adjusted.reduce((s, x) => s + x.chance, 0) || 1;
    const factor = (rates.reduce((s, x) => s + x.chance, 0) || 100) / sum;
    return adjusted.map(a => ({ ...a, chance: a.chance * factor }));
}

window.resetAccount = async () => {
    if (!confirm('ATTENTION — Êtes-vous sûr de vouloir réinitialiser votre compte ? Toutes vos cartes seront supprimées !')) {
        return;
    }
    
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
        console.error('Error getting user:', error);
        return;
    }
    const user = data.user;
    if (!user) return;
    
    try {
        await safeSetPlayerDoc(user.id, {
            collection: [],
            packs_by_gen: {},
            current_booster: [],
            booster_revealed_cards: [],
            last_draw_time: 0,
            available_packs: PACKS_PER_COOLDOWN
        }, { merge: true });
        
        closePopup();
        window.showPopup("<img src='assets/icons/check.svg' class='icon-inline' alt='ok'> Compte réinitialisé", "Votre compte a été réinitialisé avec succès. Rechargez la page.");
        setTimeout(() => location.reload(), 2000);
    } catch (e) {
        window.showPopup("Erreur", "Impossible de réinitialiser le compte: " + e.message);
    }
};

window.deleteAccount = async () => {
    if (!confirm('ATTENTION — Voulez-vous vraiment SUPPRIMER COMPLÈTEMENT votre compte ? Cette action est IRRÉVERSIBLE !')) {
        return;
    }
    
    if (!confirm('Dernière confirmation : Supprimer définitivement votre compte ?')) {
        return;
    }
    
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
        console.error('Error getting user:', error);
        return;
    }
    const user = data.user;
    if (!user) return;
    
    try {
        // Supprimer les données Supabase (players et sessions)
        await deletePlayerDoc(user.id);
        await deleteSessionDoc(user.id);
        
        // Déconnecter l'utilisateur (Supabase ne permet pas de supprimer son propre compte via le client)
        // L'admin devra supprimer le compte Auth depuis le dashboard
        await supabase.auth.signOut();
        
        closePopup();
        window.showPopup(
            "<img src='assets/icons/check.svg' class='icon-inline' alt='ok'> Données supprimées",
            "Vos données de jeu ont été supprimées de l'application. Votre compte d'authentification (utilisé pour vous connecter) n'est pas supprimé automatiquement : pour supprimer entièrement ce compte, contactez un administrateur."
        );
        setTimeout(() => location.reload(), 3000);
    } catch (e) {
        if (e.message && e.message.includes('session')) {
            window.showPopup("Erreur", "Vous devez vous reconnecter récemment pour supprimer votre compte. Déconnectez-vous et reconnectez-vous, puis réessayez.");
        } else {
            window.showPopup("Erreur", "Impossible de supprimer les données: " + e.message);
        }
    }
};

// --- GESTION QUANTITÉ DE PACKS ---
window.updatePackQuantity = async () => {
    const select = document.getElementById('pack-quantity');
    const btn = document.getElementById('btn-draw');
    const quantity = parseInt(select.value) || 0; // Ensure quantity is a number
    const { data, error } = await supabase.auth.getUser();
    if (error) {
        console.error('Error getting user:', error);
        return;
    }
    const user = data?.user;
    const isAdmin = user && (user.email === ADMIN_EMAIL);
    
    // Vérifier si l'utilisateur a assez de packs
    let available_packs = PACKS_PER_COOLDOWN;
    if (user && !isAdmin && btn) {
        const genSelect = document.getElementById('gen-select');
        const selectedGen = genSelect.value;
        
        try {
            const snap = await getPlayerDoc(user.id);
            if (snap.exists()) {
                const packs_by_gen = snap.data().packs_by_gen || {};
                const genData = packs_by_gen[selectedGen] || { available_packs: PACKS_PER_COOLDOWN };
                available_packs = genData.available_packs ?? PACKS_PER_COOLDOWN;
                
                // Désactiver le bouton si pas assez de packs, sinon le réactiver
                if (available_packs < quantity) {
                    btn.disabled = true;
                    btn.classList.add('disabled');
                } else {
                    btn.disabled = false;
                    btn.classList.remove('disabled');
                }
            }
        } catch (e) {
            console.error("Erreur vérification packs:", e);
        }
    }
    
    // Toujours mettre à jour le texte du bouton (sauf si en mode PATIENTEZ ou affichage timer)
    if (btn && !btn.innerHTML.includes('PATIENTEZ') && !btn.innerHTML.includes('Prochain dans')) {
        if (quantity > 1) {
            btn.innerHTML = `<div class="booster-content">OUVRIR ${quantity} BOOSTERS</div>`;
        } else {
            btn.innerHTML = '<div class="booster-content">OUVRIR UN BOOSTER</div>';
        }
    }
    
    // Mettre à jour l'affichage du nombre de packs disponibles
    const packsInfo = document.getElementById('packs-info');
    if (packsInfo && user && !isAdmin) {
        packsInfo.textContent = `(${available_packs}/${PACKS_PER_COOLDOWN} disponibles)`;
    }
};

// --- AFFICHAGE DES PROBABILITÉS ---
window.showDropRates = () => {
    const packInfo = `
<h3 class="h3-icon"><img src="assets/icons/gift.svg" class="icon-inline" alt="gift"><span>SYSTÈME DE PACKS :</span></h3>
<ul><li>• Vous disposez de 3 packs maximum par génération</li>
<li>• Les 3 packs se régénèrent toutes les ${COOLDOWN_MINUTES} minutes</li>
<li>• Vous pouvez ouvrir plusieurs packs d'un coup</li>
<li>• Chaque génération a son propre cooldown indépendant</li></ul>

<h3 class="h3-icon"><img src="assets/icons/dices.svg" class="icon-inline" alt="dices"><span>TAILLE DU PACK :</span></h3>
<ul><li>• 75% de chance d'obtenir 4 cartes</li>
<li>• 25% de chance d'obtenir 5 cartes</li></ul>

<h3 class="h3-icon"><img src="assets/icons/chart-column.svg" class="icon-inline" alt="chart"><span>PROBABILITÉS DE RARETÉ (Cartes 1-4) :</span></h3>
<ul><li>• <span class="dot dot-common">⬤</span> Commune : 56%</li>
<li>• <span class="dot dot-uncommon">⬤</span> Peu Commune : 26%</li>
<li>• <span class="dot dot-rare">⬤</span> Rare : 14%</li>
<li>• <span class="dot dot-ultra">⬤</span> Ultra Rare : 3.8%</li>
<li>• <img src="assets/icons/star.svg" class="icon-inline" alt="secret"> Secrète : 0.2%</li></ul>

<h3 class="h3-icon"><img src="assets/icons/star.svg" class="icon-inline" alt="star"><span>5ème CARTE (si pack de 5) :</span></h3>
<ul><li>• <span class="dot dot-rare">⬤</span> Rare : 68%</li>
<li>• <span class="dot dot-ultra">⬤</span> Ultra Rare : 30%</li>
<li>• <img src="assets/icons/star.svg" class="icon-inline" alt="secret"> Secrète : 2%</li></ul>
<p class="drop-note"><em>Pas de commune ou peu commune</em></p>

<h3 class="h3-icon"><img src="assets/icons/octagon-x.svg" class="icon-inline" alt="limit"><span>LIMITE :</span></h3>
Maximum 2 cartes identiques par pack
    `.trim();
    
    window.showPopup("SYSTÈME DE DROP", packInfo);
};

// --- AUTHENTIFICATION ---
// Timeout de sécurité pour le loader - sera initialisé au démarrage
let authLoadingTimeout = null;

// Démarrer le timeout d'authentification
function startAuthTimeout() {
    // Annuler tout timeout existant
    if (authLoadingTimeout) {
        clearTimeout(authLoadingTimeout);
    }
    
    authLoadingTimeout = setTimeout(async () => {
        const loader = document.getElementById('global-loader');
        if (loader && loader.style.display !== 'none') {
            Logger.error('Timeout du chargement - forçage de l\'affichage');
            loader.style.display = 'none';
            // Si pas d'utilisateur après timeout, afficher l'écran de connexion
            const { data } = await supabase.auth.getUser();
            if (!data.user) {
                document.getElementById('auth-overlay').style.display = 'flex';
                window.showPopup("Erreur de chargement", "Le chargement a pris trop de temps. Veuillez vous reconnecter.");
            }
        }
        authLoadingTimeout = null;
    }, AUTH_LOADING_TIMEOUT_MS);
}

// Démarrer le timeout au chargement de la page
startAuthTimeout();

supabase.auth.onAuthStateChange(async (event, session) => {
    const loader = document.getElementById('global-loader');
    let isAdmin = false;
    
    // Annuler le timeout si l'auth se résout
    if (authLoadingTimeout) {
        clearTimeout(authLoadingTimeout);
        authLoadingTimeout = null;
    }
    
    const user = session?.user;
    
    if (user) {
        Logger.info('Utilisateur connecté', { email: user.email, uid: user.id });
        
        try {
            // Vérifier l'instance unique
            const canContinue = await startSessionMonitoring(user.id);
            if (!canContinue) {
                Logger.warn('Instance unique bloquée');
                return;
            }
            
            // Connecté
            document.getElementById('auth-overlay').style.display = 'none';
            document.getElementById('game-app').style.display = 'block';
            document.getElementById('user-display').innerText = user.email.split('@')[0];
            
            // Vérif Admin (Basique sur email)
            isAdmin = (user.email === ADMIN_EMAIL);
            const adminPreview = document.getElementById('admin-preview-container');
            if (adminPreview) adminPreview.style.display = 'block';
            
            // Menu profil au clic sur le profil
            const userProfilePill = document.getElementById('user-profile-pill');
            if(userProfilePill) {
                userProfilePill.onclick = () => {
                    if(isAdmin) {
                        window.location.href = 'admin.html';
                    } else {
                        showProfileMenu();
                    }
                };
            }

            // Empêcher la désactivation simultanée des toggles Possédées / Manquantes
            const showOwnedEl = document.getElementById('show-owned');
            const showMissingEl = document.getElementById('show-missing');
            const ensureAtLeastOne = (changedEl, otherEl) => {
                if (!changedEl.checked && !otherEl.checked) {
                    // Si les deux sont décochés, réactiver l'autre
                    otherEl.checked = true;
                }
                filterBinder();
            };
            if (showOwnedEl && showMissingEl) {
                showOwnedEl.onchange = () => { ensureAtLeastOne(showOwnedEl, showMissingEl); };
                showMissingEl.onchange = () => { ensureAtLeastOne(showMissingEl, showOwnedEl); };
            }

            // Check Notifications (Visuel uniquement)
            updateBellIcon();
            // Icons are not loaded from CDN anymore
            // Attacher le clic sur la cloche pour activer/désactiver les notifications
            const bellEl = document.getElementById('notif-bell');
            if (bellEl) {
                bellEl.onclick = async () => {
                    await toggleNotifications();
                };
            }

            // 1. Charger la collection
            Logger.debug('Chargement collection utilisateur');
            await fetchUserCollection(user.id);
            
            // 2. Vérifier si un booster est en cours d'ouverture
            const snap = await getPlayerDoc(user.id);
            const playerData = snap.data();
            if (snap.exists() && playerData.current_booster && playerData.current_booster.length > 0) {
                // Restaurer l'ouverture en cours
                Logger.info('Restauration booster en cours');
                tempBoosterCards = playerData.current_booster;
                const revealedCards = playerData.booster_revealed_cards || [];
                openBoosterVisual(revealedCards);
            }
            
            // Vérifier les notifications admin
            if (snap.exists() && playerData.admin_notification) {
                const notif = playerData.admin_notification;
                window.showPopup("Notification Admin", notif.message);
                // Supprimer la notification après affichage (utiliser safe write)
                await safeSetPlayerDoc(user.id, { admin_notification: null }, { merge: true });
            }
            
            // 3. Charger le classeur (Gen par défaut)
            Logger.debug('Chargement classeur');
            // Apply URL state (gen/filters/qty/search) before loading
            try { applyUrlState(); } catch (e) { /* silent */ }
            await changeGen(); 

            // 4. Vérifier le Cooldown
            if (!isAdmin) await checkCooldown(user.id);
            else enableBoosterButton(true);

            // Fin du chargement
            Logger.info('Chargement terminé avec succès');
            if(loader) loader.style.display = 'none';
            
        } catch (error) {
            Logger.error('Erreur lors du chargement de l\'application', error);
            if(loader) loader.style.display = 'none';
            
            // Message d'erreur plus détaillé selon le type d'erreur
            let errorMessage = "Une erreur est survenue lors du chargement.\n\n";
            
            if (error.code === 'permission-denied') {
                errorMessage += "Problème de permissions. Vérifiez votre connexion et réessayez.";
            } else if (error.code === 'unavailable') {
                errorMessage += "Service temporairement indisponible. Veuillez réessayer dans quelques instants.";
            } else if (error.message) {
                errorMessage += `Détails: ${error.message}\n\nRechargez la page ou contactez le support.`;
            } else {
                errorMessage += "Rechargez la page (F5) ou videz le cache si le problème persiste.";
            }
            
            window.showPopup("Erreur", errorMessage);
        }

        
    } else {
        Logger.info('Utilisateur non connecté');
        // Déconnecté
        document.getElementById('game-app').style.display = 'none';
        document.getElementById('auth-overlay').style.display = 'flex';
        if(cooldownInterval) clearInterval(cooldownInterval);
        if(loader) loader.style.display = 'none';
    }
});

// Récupérer la collection depuis Supabase
async function fetchUserCollection(uid) {
    try {
        const snap = await getPlayerDoc(uid);
        const playerData = snap.data();
        if (snap.exists()) {
            userCollection = playerData.collection || [];
            const countEl = document.getElementById('card-count');
            if(countEl) countEl.innerText = userCollection.length;
            // Apply role class to the profile pill for per-role icon filters
            try {
                const role = playerData.role || 'player';
                const userProfilePill = document.getElementById('user-profile-pill');
                if (userProfilePill) {
                    userProfilePill.classList.remove('role-player','role-admin','role-vip');
                    userProfilePill.classList.add(`role-${role}`);
                }
            } catch(e) { /* noop */ }
            
            // Mettre à jour l'affichage des points
            updatePointsDisplay();
        } else {
            // Le compte n'existe pas -> Recréer automatiquement
            console.log("Document joueur inexistant, création...");
            const { data } = await supabase.auth.getUser();
            await safeSetPlayerDoc(uid, {
                email: data.user.email,
                collection: [],
                packs_by_gen: {},
                last_draw_time: 0,
                available_packs: PACKS_PER_COOLDOWN,
                role: 'player',
                points: 0,
                bonus_packs: 0
            }, { merge: true });
            userCollection = [];
            const countEl = document.getElementById('card-count');
            if(countEl) countEl.innerText = 0;
            // ensure profile pill gets default role class
            try {
                const userProfilePill = document.getElementById('user-profile-pill');
                if (userProfilePill) {
                    userProfilePill.classList.remove('role-player','role-admin','role-vip');
                    userProfilePill.classList.add('role-player');
                }
            } catch(e) { /* noop */ }
            updatePointsDisplay();
        }
    } catch (e) {
        console.error("Erreur chargement collection:", e);
        window.showPopup("Erreur", "Impossible de charger votre profil. Veuillez vous reconnecter.");
        await supabase.auth.signOut();
    }
}

// Fonction pour afficher les points et bonus packs
async function updatePointsDisplay() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const snap = await getPlayerDoc(user.id);
    if (!snap.exists()) return;
    
    const data = snap.data();
    const genSelect = document.getElementById('gen-select');
    const currentGen = genSelect ? genSelect.value : 'gen7';
    
    // Récupérer les données de la génération active
    const packs_by_gen = data.packs_by_gen || {};
    const genData = packs_by_gen[currentGen] || { points: 0, bonus_packs: 0 };
    const points = genData.points || 0;
    const bonus_packs = genData.bonus_packs || 0;
    // Seuil de points pour cet utilisateur (VIP = 20)
    const pointsForThisUser = (data.role === 'vip') ? 20 : POINTS_FOR_BONUS_PACK;
    // Mettre à jour la valeur des points
    const pointsValueEl = document.getElementById('points-value');
    if (pointsValueEl) {
        pointsValueEl.textContent = `${points}/${pointsForThisUser}`;
    }
    
    // Mettre à jour la barre de progression
    const progressFillEl = document.getElementById('points-progress-fill');
    if (progressFillEl) {
        const percentage = (points / pointsForThisUser) * 100;
        progressFillEl.style.width = `${percentage}%`;
    }
    
    // Afficher/masquer la section des bonus packs
    const bonusInfoEl = document.getElementById('bonus-packs-info');
    const bonusCountEl = document.getElementById('bonus-packs-count');
    const bonusPluralEl = document.getElementById('bonus-plural');
    const bonusBtnContent = document.querySelector('#bonus-packs-info .bonus-btn-content');
    
    if (bonusInfoEl && bonusCountEl) {
        if (bonus_packs > 0) {
            bonusInfoEl.style.display = 'block';
            bonusCountEl.textContent = bonus_packs;

            // Formuler correctement au singulier / pluriel pour le bouton
            // Exemples : "Utiliser votre booster bonus (1 disponible)" ou "Utiliser vos boosters bonus (2 disponibles)"
            if (bonusBtnContent) {
                const pronoun = bonus_packs === 1 ? 'votre' : 'vos';
                const noun = bonus_packs === 1 ? 'booster bonus' : 'boosters bonus';
                const dispo = bonus_packs === 1 ? 'disponible' : 'disponibles';
                const label = `${pronoun} ${noun} (${bonus_packs} ${dispo})`;
                // Rebuild content keeping the icon and same classes
                bonusBtnContent.innerHTML = `
                    <img src="assets/icons/gift.svg" class="title-icon" alt="gift">
                    <span>Utiliser ${label}</span>
                `;
            }

            if (bonusPluralEl) {
                bonusPluralEl.textContent = bonus_packs > 1 ? 's' : '';
            }
        } else {
            bonusInfoEl.style.display = 'none';
        }
    }
}

// Fonction pour utiliser un bonus pack
window.useBonusPack = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const snap = await getPlayerDoc(user.id);
    if (!snap.exists()) return;
    
    const data = snap.data();
    const genSelect = document.getElementById('gen-select');
    const currentGen = genSelect ? genSelect.value : 'gen7';
    
    // Récupérer les données de la génération active
    const packs_by_gen = data.packs_by_gen || {};
    const genData = packs_by_gen[currentGen] || { points: 0, bonus_packs: 0 };
    const bonus_packs = genData.bonus_packs || 0;
    
    if (bonus_packs <= 0) {
        window.showPopup("Pas de bonus", "Vous n'avez pas de booster bonus disponible pour cette génération.");
        return;
    }
    // Ouvrir autant de boosters que de boosters bonus accumulés
    // drawCard gère la consommation des bonus quand on passe { isBonus: true }
    await drawCard(bonus_packs, { isBonus: true });
}

// Fonction pour ouvrir la boutique
window.openShop = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    
    const snap = await getPlayerDoc(user.id);
    if (!snap.exists()) return;
    
    const data = snap.data();
    const genSelect = document.getElementById('gen-select');
    const currentGen = genSelect ? genSelect.value : 'gen7';
    const packs_by_gen = data.packs_by_gen || {};
    const genData = packs_by_gen[currentGen] || { points: 0, bonus_packs: 0 };
    const points = genData.points || 0;
    const bonus_packs = genData.bonus_packs || 0;
    
    const shopHtml = `
        <div style="text-align: center;">
            <div style="font-size: 3rem; margin: 20px 0;"><img src="assets/icons/gift.svg" class="icon-inline" alt="gift"></div>
                <div style="font-size: 1.2rem; margin-bottom: 20px;">
                <strong>Vos points :</strong> ${points}/${pointsForThisUser}<br>
                <strong>Boosters bonus disponibles :</strong> ${bonus_packs}
            </div>
            <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 10px; margin: 20px 0;">
                <p style="margin: 10px 0;"><img src="assets/icons/gem.svg" class="icon-inline" alt="points"> Chaque carte obtenue vous donne <strong>${POINTS_PER_CARD} point</strong></p>
                <p style="margin: 10px 0;"><img src="assets/icons/gift.svg" class="icon-inline" alt="gift"> Chaque fois que vous atteignez <strong>${pointsForThisUser} points</strong>, vous gagnez un booster bonus</p>
                <p style="margin: 10px 0;"><img src="assets/icons/sparkles.svg" class="icon-inline" alt="spark"> Les points excédentaires sont conservés pour le prochain booster</p>
            </div>
            <div style="background: rgba(59, 76, 202, 0.2); padding: 15px; border-radius: 10px; margin-top: 15px; border: 2px solid rgba(59, 76, 202, 0.5);">
                <p style="color: var(--secondary); font-weight: bold; margin-bottom: 10px;"><img src="assets/icons/chart-column.svg" class="icon-inline" alt="chart"> Progression actuelle</p>
                <div style="width: 100%; height: 30px; background: rgba(0,0,0,0.4); border-radius: 15px; overflow: hidden; margin: 10px 0;">
                    <div style="height: 100%; width: ${(points / pointsForThisUser) * 100}%; background: linear-gradient(90deg, #FFD700 0%, #FFA500 100%); border-radius: 15px; transition: width 0.5s ease;"></div>
                </div>
                <p style="color: #ccc; font-size: 0.9rem;">${points} / ${pointsForThisUser} points</p>
            </div>
            ${bonus_packs > 0 ? `
                <button onclick="closePopup(); useBonusPack();" class="btn-primary" style="width: 100%; padding: 15px; margin-top: 20px; font-size: 1.1rem;">
                    <img src="assets/icons/gift.svg" class="icon-inline" alt="gift"> Utiliser un booster bonus (${bonus_packs} disponible${bonus_packs > 1 ? 's' : ''})
                </button>
            ` : `
                <p style="color: #999; margin-top: 20px;">Collectionnez plus de cartes pour gagner des boosters bonus !</p>
            `}
        </div>
    `;
    
    window.showPopup("<img src='assets/icons/gift.svg' class='icon-inline' alt='shop'> BOUTIQUE", shopHtml);
}

// --- LOGIQUE CLASSEUR (BINDER) ---
window.changeGen = async () => {
    const genSelect = document.getElementById('gen-select');
    if(!genSelect) return;
    
    const gen = genSelect.value;
    const grid = document.getElementById('cards-grid');
    // Ne pas afficher le texte "Chargement du classeur..." dans la grille pour éviter
    // le déplacement visuel — laisser la grille vide jusqu'à ce que les cartes soient prêtes.
    grid.innerHTML = '';

    // Ne pas insérer le placeholder dans les stats non plus
    const statsContainer = document.getElementById('rarity-stats');
    if (statsContainer) {
        statsContainer.innerHTML = '<div class="rarity-stat-loading" style="width:100%; text-align:center;">Chargement du classeur...</div>';
        statsContainer.style.display = 'flex';
    }

    currentGenData = []; // Reset des données locales
    
    // Vérifier le cooldown de cette génération
    const { data: { user } } = await supabase.auth.getUser();
    if (user && user.email !== ADMIN_EMAIL) {
        await checkCooldown(user.id);
    }
    
    // Mettre à jour la disponibilité du bouton selon la quantité sélectionnée
    await updatePackQuantity();
    
    // Mettre à jour l'affichage des points pour cette génération
    await updatePointsDisplay();
    
    // On charge tous les JSONs de la génération
    for (const rate of GAME_CONFIG.dropRates) {
        try {
            const res = await fetch(`data/${gen}/${rate.filename}`);
            if(res.ok) {
                const list = await res.json();
                // On attache la rareté à chaque carte pour l'affichage
                list.forEach(c => c.rarityKey = rate.type);
                currentGenData.push(...list);
            }
        } catch(e) {
            // Ignorer si un fichier manque
        }
    }

    // Tri par ID Pokédex croissant
    currentGenData.sort((a,b) => a.id - b.id);
    
    // Renumérotation des cartes de 1 à X pour l'affichage du classeur
    currentGenData.forEach((card, index) => {
        card.displayId = index + 1; // Numéro dans le classeur (1, 2, 3...)
        card.pokedexId = card.id;   // ID Pokédex original (pour référence)
    });
    
    renderBinder();
};

function renderBinder() {
    const grid = document.getElementById('cards-grid');
    grid.innerHTML = '';
    // NOTE: don't hide the stats container here — show loading placeholder from changeGen
    
    const searchInput = document.getElementById('search-input');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";
    
    const sortSelect = document.getElementById('sort-select');
    const sortType = sortSelect ? sortSelect.value : 'id';

    // Attach listeners to some controls to reflect their state in URL
    try {
        const searchInput = document.getElementById('search-input');
        if (searchInput && !searchInput._urlHooked) {
            searchInput.addEventListener('input', () => { pushUrlState(); });
            searchInput._urlHooked = true;
        }
        const genSelect = document.getElementById('gen-select');
        if (genSelect && !genSelect._urlHooked) {
            genSelect.addEventListener('change', () => { pushUrlState(); });
            genSelect._urlHooked = true;
        }
        const packQty = document.getElementById('pack-quantity');
        if (packQty && !packQty._urlHooked) {
            packQty.addEventListener('change', () => { pushUrlState(); });
            packQty._urlHooked = true;
        }
    } catch (e) { /* silent */ }
    
    const showOwned = document.getElementById('show-owned');
    const showMissing = document.getElementById('show-missing');
    const displayOwned = showOwned ? showOwned.checked : true;
    const displayMissing = showMissing ? showMissing.checked : true;

    // Préparer les données avec quantité possédée (toujours réelle)
    const cardsWithOwned = currentGenData.map(cardRef => {
        const ownedCopies = userCollection.filter(c => c.id === cardRef.id).length;
        return { ...cardRef, ownedCopies };
    });

    // Filtrer par recherche et visibilité
    const filteredCards = cardsWithOwned.filter(cardRef => {
        // Filtre recherche
        if(searchTerm && !cardRef.name.toLowerCase().includes(searchTerm)) return false;
        
        // Filtre par rareté sélectionnée
        if(selectedRarityFilter && cardRef.rarityKey !== selectedRarityFilter) return false;
        
        // Filtre possédée/manquante
        const isOwned = cardRef.ownedCopies > 0;
        if (isOwned && !displayOwned) return false;
        if (!isOwned && !displayMissing) return false;
        
        // Ne pas montrer les secrètes non possédées (sauf en preview admin)
        if (!isOwned && cardRef.rarityKey === 'secret' && !adminShowAllMode) return false;
        
        return true;
    });

    // Trier selon le critère
    const rarityValues = { 'secret': 5, 'ultra_rare': 4, 'rare': 3, 'uncommon': 2, 'common': 1 };
    
    filteredCards.sort((a, b) => {
        switch(sortType) {
            case 'name-asc':
                return a.name.localeCompare(b.name);
            case 'name-desc':
                return b.name.localeCompare(a.name);
            case 'rarity-desc':
                return (rarityValues[b.rarityKey] || 0) - (rarityValues[a.rarityKey] || 0);
            case 'rarity-asc':
                return (rarityValues[a.rarityKey] || 0) - (rarityValues[b.rarityKey] || 0);
            case 'id-desc':
                return b.id - a.id;
            case 'id-asc':
            default:
                return a.id - b.id;
        }
    });

    // Calculer les stats par rareté
    const rarityStats = {
        common: { owned: 0, total: 0 },
        uncommon: { owned: 0, total: 0 },
        rare: { owned: 0, total: 0 },
        ultra_rare: { owned: 0, total: 0 },
        secret: { owned: 0, total: 0 }
    };
    
    currentGenData.forEach(cardRef => {
        const rarity = cardRef.rarityKey || 'common';
        if (rarityStats[rarity]) {
            rarityStats[rarity].total++;
            const ownedCount = userCollection.filter(c => c.id === cardRef.id).length;
            if (ownedCount > 0) rarityStats[rarity].owned++;
        }
    });
    
    // Afficher les stats
    const statsContainer = document.getElementById('rarity-stats');
    if (statsContainer) {
        const labels = {
            common: { emoji: '<span class="dot dot-common">⬤</span>', name: 'Communes' },
            uncommon: { emoji: '<span class="dot dot-uncommon">⬤</span>', name: 'Peu Com.' },
            rare: { emoji: '<span class="dot dot-rare">⬤</span>', name: 'Rares' },
            ultra_rare: { emoji: '<span class="dot dot-ultra">⬤</span>', name: 'Ultra Rares' },
            secret: { emoji: '<img src="assets/icons/star.svg" class="icon-inline" alt="secret">', name: 'Secrètes' }
        };
        
        // Calculer le total global
        let totalOwned = 0;
        let totalCards = 0;
        Object.values(rarityStats).forEach(stats => {
            totalOwned += stats.owned;
            totalCards += stats.total;
        });
        const globalPercent = totalCards > 0 ? Math.round((totalOwned / totalCards) * 100) : 0;
        
        // Badge global en premier
        const targetFilterComplete = 'brightness(0) saturate(100%) invert(54%) sepia(64%) saturate(420%) hue-rotate(73deg) brightness(96%) contrast(88%)';
        const targetFilterDefault = 'brightness(0) saturate(100%) invert(65%) sepia(4%) saturate(9%) hue-rotate(38deg) brightness(93%) contrast(92%)';
        const targetFilter = (totalOwned === totalCards) ? targetFilterComplete : targetFilterDefault;

        let badgesHtml = `<div class="rarity-stat-badge ${totalOwned === totalCards ? 'complete' : 'incomplete'}" 
            onclick="toggleRarityFilter(null)" 
            style="cursor: pointer; ${selectedRarityFilter === null ? 'box-shadow: 0 0 15px rgba(255, 222, 0, 0.3); transform: scale(1.05);' : ''}">
            <img src="assets/icons/target-arrow.svg" class="icon-inline" alt="target" style="filter: ${targetFilter};">
            <span>TOTAL: ${totalOwned}/${totalCards}</span>
            <span class="percent">(${globalPercent}%)</span>
        </div>`;
        
        // Badges par rareté
        badgesHtml += Object.entries(rarityStats)
            .filter(([_, stats]) => stats.total > 0)
            .map(([rarity, stats]) => {
                const label = labels[rarity];
                const percent = Math.round((stats.owned / stats.total) * 100);
                const isComplete = stats.owned === stats.total;
                const isSelected = selectedRarityFilter === rarity;

                // Pour la rareté secrète, appliquer le même comportement de filtre que pour le target-arrow
                let emojiHtml = label.emoji;
                if (rarity === 'secret') {
                    const secretFilterComplete = targetFilterComplete;
                    const secretFilterDefault = targetFilterDefault;
                    const secretFilter = isComplete ? secretFilterComplete : secretFilterDefault;
                    emojiHtml = `<img src="assets/icons/star.svg" class="icon-inline" alt="secret" style="filter: ${secretFilter};">`;
                }

                return `<div class="rarity-stat-badge ${isComplete ? 'complete' : 'incomplete'}" 
                    onclick="toggleRarityFilter('${rarity}')" 
                    style="cursor: pointer; ${isSelected ? 'box-shadow: 0 0 15px rgba(255, 222, 0, 0.3); transform: scale(1.05);' : ''}" 
                    title="Cliquez pour filtrer">
                    <span class="emoji">${emojiHtml}</span>
                    <span>${label.name}: ${stats.owned}/${stats.total}</span>
                    <span class="percent">(${percent}%)</span>
                </div>`;
            })
            .join('');
            
        statsContainer.innerHTML = badgesHtml;
        // Afficher le panneau de stats une fois le contenu prêt
        statsContainer.style.display = 'flex';
        // If selected rarity filter is no longer valid for this generation, clear it
        try {
            const rarityKeys = Object.keys(rarityStats).filter(k => rarityStats[k].total > 0);
            if (selectedRarityFilter && !rarityKeys.includes(selectedRarityFilter)) {
                selectedRarityFilter = null;
                pushUrlState();
            }
        } catch (e) { /* silent */ }
    }
    
    // Message si aucun résultat
        if (filteredCards.length === 0) {
        grid.innerHTML = '<div style="color: #999; text-align: center; padding: 40px; font-size: 1.2rem;"> <img src="assets/icons/x.svg" class="icon-inline" alt="x"> Aucune carte ne correspond aux filtres</div>';
        return;
    }

    filteredCards.forEach(cardRef => {
        const ownedCopies = cardRef.ownedCopies;

        // Render full card face if owned OR if admin preview is active (simulate view-only)
        if (ownedCopies > 0 || adminShowAllMode) {
            // If owned, show the user's copy; otherwise show the gen card data for preview
            const userCard = ownedCopies > 0 ? userCollection.find(c => c.id === cardRef.id) : cardRef;
            const cardToRender = userCard ? { ...userCard, rarityKey: cardRef.rarityKey } : cardRef;

            // Calculer le total de cartes de cette génération
            const totalCards = currentGenData.length;

            // Pass ownedCopies (0 if not actually owned) so the UI still reflects real ownership counts
            const el = createCardElement(cardToRender, ownedCopies, cardRef.displayId, totalCards);

            // Preview-only visual marker removed (no class added)

            grid.appendChild(el);
        } else {
            // --- CARTE MANQUANTE (PLACEHOLDER) ---
            const el = document.createElement('div');
            el.className = 'card-placeholder';
            el.innerHTML = `
                <div class="placeholder-id">#${cardRef.displayId || cardRef.id}</div>
                <div class="placeholder-text">???</div>
            `;
            grid.appendChild(el);
        }
    });
    // Masquer l'écran de chargement après le premier rendu complet du classeur
    try {
        if (!window._binderHasLoaded) {
            const loaderEl = document.getElementById('global-loader');
            if (loaderEl) loaderEl.style.display = 'none';
            window._binderHasLoaded = true;
        }
    } catch (e) {
        console.warn('Impossible de masquer le loader après rendu du classeur', e);
    }
}

// Fonction appelée par la barre de recherche
window.filterBinder = () => {
    renderBinder();
    pushUrlState();
};

// Fonction pour filtrer par rareté
window.toggleRarityFilter = (rarity) => {
    if (selectedRarityFilter === rarity) {
        // Si on clique sur le même filtre, on le désactive
        selectedRarityFilter = null;
    } else {
        selectedRarityFilter = rarity;
    }
    renderBinder();
    pushUrlState();
};

// Mode admin : afficher toutes les cartes
window.toggleAdminPreview = () => {
    const checkbox = document.getElementById('admin-show-all');
    adminShowAllMode = checkbox ? checkbox.checked : false;
    renderBinder();
    try { pushUrlState(); } catch (e) { /* silent */ }
};

// Création du HTML d'une carte (Compatible Pokémon & Events)
function createCardElement(card, quantity = 1, cardNumber = null, totalCards = null) {
    const div = document.createElement('div');
    const mainType = card.types ? card.types[0] : 'Normal';
    const cssRarity = card.rarityKey ? card.rarityKey.replace('_', '-') : 'commune';
    
    const labels = {'common':'COMMUNE', 'uncommon':'PEU COM.', 'rare':'RARE', 'ultra_rare':'ULTRA RARE', 'secret':'SECRET'};
    const labelText = labels[card.rarityKey] || '';
    const label = quantity > 1 ? `${labelText}  |  x${quantity}` : labelText;
    
    // Ajouter le numéro dans le nom si disponible
    const cardName = (cardNumber && totalCards) ? `N°${cardNumber}/${totalCards} | ${card.name}` : card.name;
    
    const icon = GAME_CONFIG.icons[mainType] || GAME_CONFIG.icons['Normal'];
    const weakIcon = GAME_CONFIG.icons[card.weakness] || GAME_CONFIG.icons['Normal'];
    const resIcon = card.resistance ? GAME_CONFIG.icons[card.resistance] : null;
    const retreatCircles = (card.retreatCost && card.retreatCost > 0) ? '<span class="dot dot-common">⬤</span>'.repeat(card.retreatCost) : '-';

    div.className = `tcg-card ${cssRarity} bg-${mainType}`;

    let bodyContent = '';
    
    // NOUVEAU : Si la carte a une description (Carte Événement)
    if(card.description) {
        bodyContent = `<div class="card-description">${card.description}</div>`;
    } else if(card.attacks && card.attacks.length > 0) {
        // Attaques normales de Pokémon
        card.attacks.forEach(a => {
            const costHtml = Array(a.cost).fill(`<img src="${icon}" class="type-icon small">`).join('');
            bodyContent += `
                <div class="move-row">
                    <div class="cost-icons">${costHtml}</div>
                    <div class="move-info"><div class="move-name">${a.name}</div></div>
                    <div class="move-dmg">${a.damage}</div>
                </div>`;
        });
    }
    
    // Afficher les HP seulement si > 0
    const hpDisplay = card.hp > 0 ? `${card.hp} PV <img src="${icon}" class="type-icon big">` : '';
    
    // Si c'est une carte événement (avec description), on peut masquer le footer ou le garder pour le style
    // Ici je le garde mais tu peux l'enlever avec une condition
    const hasFooter = !card.description;

    div.innerHTML = `
        ${label ? `<div class="rarity-badge badge-${cssRarity}">${label}</div>` : ''}
        <div class="card-header">
            <span class="card-name">${cardName}</span>
            <div class="hp-group">${hpDisplay}</div>
        </div>
        <div class="img-frame">
            <img src="${card.image}" class="card-img" loading="lazy" alt="${card.name}" 
                 onerror="this.style.display='none'">
        </div>
        <div class="card-body">${bodyContent}</div>
        ${hasFooter ? `
        <div class="card-footer">
            <div class="stat-box">Faiblesse<br><img src="${weakIcon}" class="type-icon small"></div>
            <div class="stat-box">Résist.<br>${resIcon ? `<img src="${resIcon}" class="type-icon small">` : '-'}</div>
            <div class="stat-box">Retraite<br>${retreatCircles}</div>
        </div>
        ` : ''}
    `;
    return div;
}

// --- OUVERTURE DE BOOSTER ---
window.drawCard = async (overridePackQuantity = null, options = {}) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const isAdmin = (user.email === ADMIN_EMAIL);
    // Récupérer le rôle/utilisateur (utile pour VIP)
    const userSnapForDraw = await getPlayerDoc(user.id);
    const userRoleForDraw = userSnapForDraw && userSnapForDraw.exists() ? userSnapForDraw.data().role : null;
    const isVip = userRoleForDraw === 'vip';
    const btn = document.getElementById('btn-draw');
    
    // Sécurité anti-clic
    if (!isAdmin && btn.disabled) return;

    const genSelect = document.getElementById('gen-select');
    const selectedGen = genSelect.value;
    
    // Récupérer la quantité de packs à ouvrir (peut être surchargée en param)
    const packQuantitySelect = document.getElementById('pack-quantity');
    let packQuantity;
    if (overridePackQuantity !== null && !isNaN(parseInt(overridePackQuantity))) {
        packQuantity = parseInt(overridePackQuantity);
    } else {
        packQuantity = parseInt(packQuantitySelect.value);
    }
    
    // Vérifier si l'utilisateur a assez de packs disponibles (sauf en bonus-mode)
    const isBonus = !!options.isBonus;
    if (!isAdmin && !isBonus) {
        const snap = await getPlayerDoc(user.id);
        if (snap.exists()) {
            const packs_by_gen = snap.data().packs_by_gen || {};
            const genData = packs_by_gen[selectedGen] || { available_packs: PACKS_PER_COOLDOWN };
            const available_packs = genData.available_packs ?? PACKS_PER_COOLDOWN;
            
            if (available_packs < packQuantity) {
                window.showPopup("Pas assez de packs", `Vous voulez ouvrir ${packQuantity} pack(s) mais vous n'en avez que ${available_packs} disponible(s) pour cette génération.`);
                return;
            }
        }
    }

    btn.disabled = true;
    btn.innerHTML = "Génération...";

    try {
        tempBoosterCards = [];
        
        // Ouvrir plusieurs packs
        for (let packIndex = 0; packIndex < packQuantity; packIndex++) {
            // 25% de chance d'avoir 5 cartes, 75% pour 4 cartes
            const packSize = Math.random() < 0.25 ? 5 : 4;

            for(let i=0; i<packSize; i++) {
                const rand = Math.random() * 100;
                let rarityConfig = GAME_CONFIG.dropRates[0];
                let acc = 0;
                
                // La 5ème carte (index 4) utilise des taux spéciaux
                const rates = (i === 4) ? GAME_CONFIG.dropRatesSixthCard : GAME_CONFIG.dropRates;
                const effectiveRates = isVip ? adjustRatesForVip(rates) : rates;

                for (const r of effectiveRates) {
                    acc += r.chance;
                    if (rand <= acc) { rarityConfig = r; break; }
                }

                // Fetch du fichier correspondant
                const res = await fetch(`data/${selectedGen}/${rarityConfig.filename}`);
                if(!res.ok) {
                    // Si pas de fichier (ex: pas de secrète), on prend une commune
                    const fallback = await fetch(`data/${selectedGen}/common.json`);
                    var list = await fallback.json();
                    rarityConfig = GAME_CONFIG.dropRates[0];
                } else {
                    var list = await res.json();
                    // Si le fichier est vide []
                    if(!list || list.length === 0) {
                        const fallback = await fetch(`data/${selectedGen}/common.json`);
                        list = await fallback.json();
                        rarityConfig = GAME_CONFIG.dropRates[0];
                    }
                }

                // Pioche avec limitation à 2 cartes identiques max par pack
                let card;
                let attempts = 0;
                const maxAttempts = 50;
                
                do {
                    card = list[Math.floor(Math.random() * list.length)];
                    const sameCardCount = tempBoosterCards.filter(c => c.id === card.id).length;
                    
                    // Si on a déjà 2 fois cette carte, on en cherche une autre
                    if (sameCardCount < 2) break;
                    
                    attempts++;
                } while (attempts < maxAttempts);
                
                // Construction de l'objet sauvegardé
                card.acquiredAt = Date.now();
                card.rarityKey = rarityConfig.type;
                card.generation = selectedGen;
                card.isFifthCard = (i === 4); // Marquer la 5ème carte
                
                tempBoosterCards.push(card);
            }
        }

        // Animation d'ouverture
        openBoosterVisual();

        // Sauvegarde Firebase
        const updateData = { 
            current_booster: tempBoosterCards, // Sauvegarde de l'ouverture en cours
            booster_revealed_cards: [] // Aucune carte révélée au départ
        };
        
        // Récupérer les données actuelles une seule fois
        const currentSnap = await getPlayerDoc(user.id);
        const currentData = currentSnap.exists() ? currentSnap.data() : {};
        const packs_by_gen = currentData.packs_by_gen || {};
        const genData = packs_by_gen[selectedGen] || { available_packs: PACKS_PER_COOLDOWN, last_draw_time: 0, points: 0, bonus_packs: 0 };
        
        // Si ce n'est pas un bonus, on décrémente les packs disponibles (sauf admin)
        if (!isAdmin && !isBonus) {
            let available_packs = genData.available_packs ?? PACKS_PER_COOLDOWN;
            available_packs = Math.max(0, available_packs - packQuantity);
            genData.available_packs = available_packs;
            genData.last_draw_time = Date.now();
        }
        
        // Calculer les points gagnés
        const cardsCount = tempBoosterCards.length;
        const pointsGained = cardsCount * POINTS_PER_CARD;
        
        const currentPoints = genData.points || 0;
        const currentBonusPacks = genData.bonus_packs || 0;
        
        // Si on utilise des boosters bonus, soustraire la quantité utilisée avant de calculer les gains
        let startingBonusPacks = currentBonusPacks;
        if (isBonus) {
            startingBonusPacks = Math.max(0, currentBonusPacks - packQuantity);
        }

        // Calculer nouveaux points et bonus packs pour cette génération (seuil différent pour VIP)
        const pointsForThisUser = isVip ? 20 : POINTS_FOR_BONUS_PACK;
        const totalPoints = currentPoints + pointsGained;
        const earnedBonusPacks = Math.floor(totalPoints / pointsForThisUser);
        const remainingPoints = totalPoints % pointsForThisUser;
        
        // Mettre à jour les données de cette génération (conserve available_packs et last_draw_time)
        packs_by_gen[selectedGen] = {
            ...genData,
            points: remainingPoints,
            bonus_packs: startingBonusPacks + earnedBonusPacks
        };
        
        updateData.packs_by_gen = packs_by_gen;
        
        // Utiliser safeSetPlayerDoc pour gérer les erreurs de quota et mettre en file si nécessaire
        await safeSetPlayerDoc(user.id, updateData, { merge: true });

        // Ajout à la collection locale
        userCollection.push(...tempBoosterCards);
        document.getElementById('card-count').innerText = userCollection.length;
        
        // Mettre à jour l'affichage des points
        updatePointsDisplay();
        
        // Mettre à jour l'affichage du nombre de packs disponibles
        await updatePackQuantity();
        
        // Stocker le nombre de boosters bonus gagnés pour l'afficher après la fermeture
        window._earnedBonusPacksThisOpen = earnedBonusPacks;

        // Gestion Timer
        if (!isAdmin) {
            // Si plus de packs disponibles pour cette génération, démarrer le timer
            const snap = await getPlayerDoc(user.id);
            if (snap.exists()) {
                const packs_by_gen = snap.data().packs_by_gen || {};
                const genData = packs_by_gen[selectedGen] || { available_packs: 0 };
                const available_packs = genData.available_packs ?? 0;
                
                if (available_packs === 0) {
                    const cooldownMins = isVip ? VIP_COOLDOWN_MINUTES : COOLDOWN_MINUTES;
                    startTimer(cooldownMins * 60 * 1000, user.id);
                }
            }
        } else { 
            // Reset bouton pour l'admin (attendra la fermeture du booster)
            // Le bouton sera réactivé dans closeBooster()
        }

    } catch (e) {
        window.showPopup("Erreur", e.message);
        btn.disabled = false;
        btn.innerHTML = '<div class="booster-content">OUVRIR UN BOOSTER</div>';
    }
};

function openBoosterVisual(alreadyRevealed = []) {
    const overlay = document.getElementById('booster-overlay');
    const container = document.getElementById('booster-cards-container');
    const closeBtn = document.getElementById('close-booster-btn');
    const revealAllBtn = document.getElementById('reveal-all-btn');
    
    container.innerHTML = '';
    // Réserver l'espace du bouton sans agrandir la page quand il apparaît
    showCloseButton(false);
    revealAllBtn.style.display = 'flex';
    overlay.style.display = 'flex';
    // Mark booster as open in URL state
    window._openBooster = true;
    try { pushUrlState(); } catch (e) { /* silent */ }
    
    // Bloquer le scroll de la page en arrière-plan
    document.body.classList.add('booster-active');

    let cardsRevealed = alreadyRevealed.length;
    
    // Calculer le displayId et totalCards pour chaque carte du booster
    const totalCards = currentGenData.length;
    
    // Compter combien de cartes possédées dans ce booster
    let cardsOwned = 0;
    tempBoosterCards.forEach(card => {
        const isOwned = userCollection.some(c => c.id === card.id);
        if (isOwned) cardsOwned++;
    });
    
    // Mettre à jour le titre avec le compteur de cartes
    const title = document.querySelector('.opening-title');
    if (title) {
        title.innerHTML = `CLIQUEZ POUR RÉVÉLER !`;
    }

    tempBoosterCards.forEach((card, index) => {
        // Trouver le displayId de la carte dans currentGenData
        const cardInGen = currentGenData.find(c => c.id === card.id);
        const cardNumber = cardInGen ? cardInGen.displayId : null;
        
        // Vérifier si la carte est nouvelle (non possédée)
        const isNewCard = !userCollection.some(c => c.id === card.id);
        
        const flipCard = document.createElement('div');
        flipCard.className = 'flip-card';
        // Marquer visuellement la 5ème carte
        if (card.isFifthCard) {
            flipCard.classList.add('fifth-card-special');
        }
        // Marquer les cartes secrètes pour l'effet de glow au hover
        if (card.rarityKey === 'secret') {
            flipCard.classList.add('secret-card');
        }
        // Petit délai pour l'effet de distribution
        flipCard.style.animationDelay = `${index * 0.1}s`;

        const inner = document.createElement('div');
        inner.className = 'flip-card-inner';

        const front = document.createElement('div');
        front.className = 'flip-card-front'; // Dos (Pokeball)
        
        const back = document.createElement('div');
        back.className = 'flip-card-back'; // Face (Carte)
        const cardEl = createCardElement(card, 1, cardNumber, totalCards);
        
        // Ajouter un badge "Nouveau !" si la carte n'est pas possédée
        if (isNewCard) {
            const newBadge = document.createElement('div');
            newBadge.className = 'new-card-badge';
            newBadge.textContent = 'Nouveau !';
            back.appendChild(newBadge);
            
            // Au survol de la carte, cacher définitivement le badge
            flipCard.addEventListener('mouseenter', function() {
                newBadge.classList.add('hidden');
                // Arrêter l'animation après un court délai
                setTimeout(() => {
                    newBadge.style.animation = 'none';
                }, 500);
            }, { once: true });
        }
        
        back.appendChild(cardEl);

        inner.appendChild(front);
        inner.appendChild(back);
        flipCard.appendChild(inner);

        // Si la carte était déjà révélée, la retourner
        if (alreadyRevealed.includes(index)) {
            flipCard.classList.add('flipped');
        }

        // La taille est gérée via CSS (aspect-ratio: 3 / 4), plus besoin de calcul JS

        // Click pour retourner
        flipCard.onclick = async () => {
            if(!flipCard.classList.contains('flipped')) {
                flipCard.classList.add('flipped');
                cardsRevealed++;
                
                // Sauvegarder la carte révélée en buffer et planifier un flush (debounced)
                alreadyRevealed.push(index);
                const { data: { user } } = await supabase.auth.getUser();
                if (user) {
                    _pendingRevealed = _pendingRevealed ? _pendingRevealed.concat(index) : [index];
                    _scheduleSaveRevealed(user.id);
                }
                
                // Si tout est révélé, on montre le bouton OK
                if(cardsRevealed === tempBoosterCards.length) {
                    showCloseButton(true);
                    document.getElementById('reveal-all-btn').style.display = 'none';
                }
            }
        };

        container.appendChild(flipCard);
    });
    
    // Si toutes les cartes sont déjà révélées, afficher le bouton directement
    if (cardsRevealed === tempBoosterCards.length) {
        showCloseButton(true);
        document.getElementById('reveal-all-btn').style.display = 'none';
    }
}

// Helper pour afficher/masquer le bouton de fermeture avec animation
function showCloseButton(show) {
    const btn = document.getElementById('close-booster-btn');
    if (!btn) return;
    if (show) {
        btn.style.visibility = 'visible';
        btn.classList.remove('pop-enter');
        // force reflow
        void btn.offsetWidth;
        btn.classList.add('pop-enter');
    } else {
        btn.classList.remove('pop-enter');
        btn.style.opacity = '0';
        setTimeout(() => {
            if (!btn.classList.contains('pop-enter')) btn.style.visibility = 'hidden';
        }, 300);
    }
}

// Révéler toutes les cartes d'un coup
window.revealAllCards = async () => {
    const flipCards = document.querySelectorAll('.flip-card:not(.flipped)');
    const revealBtn = document.getElementById('reveal-all-btn');
    if (revealBtn) revealBtn.style.display = 'none';
    const { data: { user } } = await supabase.auth.getUser();
    
    flipCards.forEach((card, index) => {
        setTimeout(() => {
            card.classList.add('flipped');
        }, index * 100); // Animation en cascade
    });
    
    // Sauvegarder toutes les cartes comme révélées
    if (user) {
        try {
            const allIndices = Array.from({length: tempBoosterCards.length}, (_, i) => i);
            // push into pending buffer and flush quickly
            _pendingRevealed = allIndices;
            // force immediate flush
            await _flushPendingRevealed(user.id);
        } catch (e) {
            console.error("Erreur sauvegarde révélation complète:", e);
        }
    }
    
    // Afficher les boutons
    setTimeout(() => {
        showCloseButton(true);
        document.getElementById('reveal-all-btn').style.display = 'none';
    }, flipCards.length * 100 + 600);
};

window.closeBooster = async () => {
    document.getElementById('booster-overlay').style.display = 'none';
    
    // Réactiver le scroll de la page
    document.body.classList.remove('booster-active');
    
    const btn = document.getElementById('btn-draw');
    
    // Désactiver le bouton pendant 3 secondes
    btn.disabled = true;
    btn.innerHTML = '<div class="booster-content">PATIENTEZ...</div>';
    
    await new Promise(resolve => setTimeout(resolve, BOOSTER_DELAY_SECONDS * 1000));
    
    // Nettoyer les données de booster en cours dans Firestore
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
        try {
            // Ensure any pending revealed indices are flushed before clearing
            await _flushPendingRevealed(user.id);

            // Ajouter les cartes ouvertes à la collection en une seule écriture
            // (réduit les écritures fréquentes qui causaient des erreurs de quota)
            try {
                if (Array.isArray(tempBoosterCards) && tempBoosterCards.length > 0) {
                    try {
                        // Try immediate write first
                        await arrayUnionUpdate(user.id, 'collection', tempBoosterCards);
                    } catch (e) {
                        const isQuota = (e && e.code && e.code === 'resource-exhausted') || (e && typeof e.message === 'string' && e.message.toLowerCase().includes('quota'));
                        if (isQuota) {
                            // Fallback: enqueue a merged add-to-collection operation
                            console.warn('Quota lors de l\'ajout à la collection — mise en file (addToCollection)', { uid: user.id, count: tempBoosterCards.length });
                            _enqueueCollectionAdd(user.id, tempBoosterCards);
                        } else {
                            console.error("Erreur ajout collection à la fermeture du booster:", e);
                        }
                    }
                }
            } catch (e) {
                console.error("Erreur ajout collection à la fermeture du booster (outer):", e);
            }

            // Nettoyer l'état du booster en cours dans Firestore
            await safeSetPlayerDoc(user.id, {
                current_booster: [],
                booster_revealed_cards: []
            }, { merge: true });
        } catch (e) {
            console.error("Erreur nettoyage booster:", e);
        }
        
        // Vérifier s'il reste des packs disponibles
        const isAdmin = (user.email === ADMIN_EMAIL);
        
        if (isAdmin) {
            // Admin peut toujours ouvrir
            btn.disabled = false;
            btn.innerHTML = '<div class="booster-content">OUVRIR UN BOOSTER</div>';
        } else {
            // Vérifier les packs disponibles pour les joueurs normaux
            await checkCooldown(user.id);
        }
    }
    
    // Réinitialiser les cartes temporaires
    tempBoosterCards = [];
    // Clear URL booster flag
    window._openBooster = false;
    try { pushUrlState(); } catch (e) { /* silent */ }
    
    // Mettre à jour l'affichage des points immédiatement après la fermeture
    try { await updatePointsDisplay(); } catch (e) { /* silent */ }

    // Recharger le binder pour montrer les nouvelles cartes
    renderBinder();
    
    // Afficher le popup de bonus packs si des packs ont été gagnés durant cette ouverture
    if (window._earnedBonusPacksThisOpen && window._earnedBonusPacksThisOpen > 0) {
        const earnedCount = window._earnedBonusPacksThisOpen;
        window._earnedBonusPacksThisOpen = 0; // Reset pour la prochaine fois
        
        const bonusText = earnedCount === 1 ? 'booster bonus' : 'boosters bonus';
        window.showPopup(
            "🎁 Booster Bonus!",
            `Félicitations ! Vous avez gagné ${earnedCount} ${bonusText} avec vos points !`
        );
    }
};

// --- COOLDOWN PAR GÉNÉRATION ---
// Helper pour régénérer les packs d'une génération
async function regeneratePacksForGen(uid, currentGen, packs_by_gen) {
    packs_by_gen[currentGen] = {
        available_packs: PACKS_PER_COOLDOWN,
        last_draw_time: 0
    };
    
    await safeSetPlayerDoc(uid, { 
        packs_by_gen: packs_by_gen
    }, { merge: true });
    
    return PACKS_PER_COOLDOWN;
}

async function checkCooldown(uid) {
    const genSelect = document.getElementById('gen-select');
    const currentGen = genSelect ? genSelect.value : 'gen7';
    
    const snap = await getPlayerDoc(uid);
    if (snap.exists()) {
        const data = snap.data();
        const packs_by_gen = data.packs_by_gen || {};
        const genData = packs_by_gen[currentGen] || { available_packs: PACKS_PER_COOLDOWN, last_draw_time: 0 };
        
        let available_packs = genData.available_packs ?? PACKS_PER_COOLDOWN;
        const lastDraw = genData.last_draw_time || 0;
        
        const diff = Date.now() - lastDraw;
        const cooldownMinutesForUser = (data.role === 'vip') ? VIP_COOLDOWN_MINUTES : COOLDOWN_MINUTES;
        const cooldownMs = cooldownMinutesForUser * 60 * 1000;
        
        // Si le cooldown est passé ET qu'il n'y a plus de packs, régénérer TOUS les packs
        const wasZero = available_packs <= 0;
        if (wasZero && diff >= cooldownMs) {
            available_packs = await regeneratePacksForGen(uid, currentGen, packs_by_gen);
        }
        
        if (available_packs > 0) {
            enableBoosterButton(true);
            // Vérifier si on peut ouvrir le nombre de packs sélectionné
            await updatePackQuantity();
        } else {
            // Calculer le temps restant avant la régénération complète
            const timeToNextPack = cooldownMs - diff;
            // S'assurer que le timer n'est jamais négatif
            if (timeToNextPack > 0) {
                startTimer(timeToNextPack, uid);
            } else {
                // Si le temps est déjà passé mais qu'on arrive ici, forcer la régénération
                // (Ne devrait normalement pas arriver grâce au check ci-dessus)
                available_packs = await regeneratePacksForGen(uid, currentGen, packs_by_gen);
                await updatePackQuantity();
                updatePacksDisplay(available_packs, true);
                enableBoosterButton(true);
            }
        }
    } else {
        enableBoosterButton(true);
        await updatePackQuantity();
    }
}

function updatePacksDisplay(count, animate = false) {
    // Cette fonction n'est plus nécessaire, tout est géré par updatePackQuantity()
    // Cacher l'ancien affichage
    const packsDisplay = document.getElementById('packs-available');
    if (packsDisplay) {
        packsDisplay.style.display = 'none';
    }
}

function startTimer(durationMs, uid = null) {
    const btn = document.getElementById('btn-draw');
    const display = document.getElementById('cooldown-display');
    
    btn.disabled = true;
    btn.classList.add('disabled');
    display.style.display = 'none';

    let remaining = durationMs;
    if (cooldownInterval) clearInterval(cooldownInterval);

    const tick = () => {
        remaining -= 1000;
        if (remaining <= 0) {
            clearInterval(cooldownInterval);
            // Send notification when packs are ready (with error handling)
            try {
                sendPacksReadyNotification();
            } catch (error) {
                Logger.error('Erreur lors de l\'envoi de la notification de packs prêts', error);
            }
            // Re-vérifier les packs disponibles
            if (uid) checkCooldown(uid);
            else enableBoosterButton(true);
            return;
        }
        const m = Math.floor((remaining / 1000 / 60) % 60);
        const s = Math.floor((remaining / 1000) % 60);
        btn.innerHTML = `<div class="booster-content"><img src="assets/icons/hourglass.svg" class="icon-inline" alt="hourglass"> Prochain dans ${m}:${s < 10 ? '0'+s : s}</div>`;
    };
    tick();
    cooldownInterval = setInterval(tick, 1000);
}

function enableBoosterButton(enabled) {
    const btn = document.getElementById('btn-draw');
    const display = document.getElementById('cooldown-display');
    if (enabled) {
        btn.disabled = false;
        btn.classList.remove('disabled');
        btn.innerHTML = '<div class="booster-content">OUVRIR UN BOOSTER</div>';
        display.style.display = 'none';
        if (cooldownInterval) clearInterval(cooldownInterval);
    }
}

// --- NOTIFICATIONS ---
const NOTIFICATION_PACKS_READY_TITLE = "Poké-TCG - Packs disponibles ! 🎉";
const NOTIFICATION_PACKS_READY_BODY = "Intéressant ! Vos packs sont maintenant disponibles. Revenez vite pour les ouvrir !";
const NOTIFICATION_PACKS_READY_BODY_SHORT = "Intéressant ! Vos packs sont maintenant disponibles.";

function sendPacksReadyNotification() {
    // Only send notification if permission is granted
    if (Notification.permission !== "granted") {
        Logger.debug('Notification ignorée: permission non accordée');
        return;
    }
    
    try {
        if (swRegistration) {
            // Use service worker notification for better mobile support
            swRegistration.showNotification(NOTIFICATION_PACKS_READY_TITLE, {
                body: NOTIFICATION_PACKS_READY_BODY,
                icon: "favicon.ico",
                badge: "favicon.ico",
                tag: "packs-ready",
                requireInteraction: false,
                vibrate: [200, 100, 200],
                data: {
                    url: window.location.href,
                    dateOfArrival: Date.now()
                }
            });
            Logger.info('Notification envoyée: packs disponibles');
        } else if ('Notification' in window) {
            // Fallback to basic notification
            const notification = new Notification(NOTIFICATION_PACKS_READY_TITLE, {
                body: NOTIFICATION_PACKS_READY_BODY_SHORT,
                icon: "favicon.ico"
            });
            
            notification.onclick = () => {
                window.focus();
                notification.close();
            };
            
            Logger.info('Notification basique envoyée: packs disponibles');
        }
    } catch (error) {
        Logger.error('Erreur lors de l\'envoi de la notification', error);
    }
}

window.requestNotification = async () => {
    if (!("Notification" in window)) {
        Logger.warn('Les notifications ne sont pas supportées par ce navigateur');
        return;
    }
    
    try {
        const permission = await Notification.requestPermission();
        updateBellIcon();
        
        if (permission === "granted") {
            Logger.info('Permission de notification accordée');
            
            // Save notification preference to user profile
            const { data: { user } } = await supabase.auth.getUser();
            if (user) {
                try {
                    await safeSetPlayerDoc(user.id, { notifications_enabled: true }, { merge: true });
                } catch (error) {
                    Logger.error('Erreur lors de la sauvegarde de la préférence de notification', error);
                }
            }
            
            // Show test notification using Service Worker
            if (swRegistration) {
                swRegistration.showNotification("Poké-TCG", {
                    body: "Notifications activées ! Vous serez averti quand vos packs seront disponibles.",
                    icon: "favicon.ico",
                    badge: "favicon.ico",
                    tag: "test-notification",
                    requireInteraction: false,
                    vibrate: [200, 100, 200]
                });
            } else {
                // Fallback to basic notification
                new Notification("Poké-TCG", { 
                    body: "Notifications activées !", 
                    icon: "favicon.ico" 
                });
            }
            
            window.showPopup("Notifications activées", "Vous recevrez une notification quand vos packs seront prêts !");
        } else if (permission === "denied") {
            Logger.warn('Permission de notification refusée');
            window.showPopup("Notifications refusées", "Vous avez refusé les notifications. Vous pouvez les activer dans les paramètres de votre navigateur.");
        } else {
            Logger.info('Permission de notification non accordée (dismissed)');
        }
    } catch (error) {
        Logger.error('Erreur lors de la demande de permission de notification', error);
        window.showPopup("Erreur", "Impossible d'activer les notifications. Veuillez réessayer.");
    }
};

function updateBellIcon() {
    const bell = document.getElementById('notif-bell');
    if (!bell) return; // élément absent -> rien à faire
    if (Notification.permission === "granted") bell.classList.add('bell-active');
    else bell.classList.remove('bell-active');
}

// Basculer la préférence de notifications utilisateur (BDD)
window.toggleNotifications = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        window.showPopup('Erreur', "Connectez-vous pour gérer les notifications.");
        return;
    }

    try {
        const snap = await getPlayerDoc(user.id);
        const playerData = snap.data();
        const current = snap.exists() ? (playerData.notifications_enabled || false) : false;

        if (current) {
            // Désactiver
            await safeSetPlayerDoc(user.id, { notifications_enabled: false }, { merge: true });
            updateBellIcon();
            window.showPopup('Notifications', 'Notifications désactivées.');
        } else {
            // Activer via la procédure existante
            await window.requestNotification();
        }
    } catch (e) {
        Logger.error('Erreur toggleNotifications', e);
        window.showPopup('Erreur', 'Impossible de changer la préférence de notification.');
    }
};

// --- AUTH HELPERS ---
window.googleLogin = async () => {
    const authMsg = document.getElementById('auth-msg');
    
    try {
        authMsg.innerText = 'Connexion en cours...';
        authMsg.style.color = '#4CAF50';
        
        Logger.info('Connexion Google avec Supabase');
        const { data, error } = await supabase.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: window.location.origin + window.location.pathname
            }
        });
        
        if (error) throw error;
        
        Logger.info('Connexion Google réussie');
        authMsg.innerText = '';
        
    } catch(e) {
        Logger.error('Erreur de connexion Google', { message: e.message });
        authMsg.style.color = '#ff6b6b';
        authMsg.innerHTML = '<img src="assets/icons/triangle-alert.svg" class="icon-inline" alt="warn"> Erreur: ' + e.message;
            }
        }
    }
};
window.signUp = async () => {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const authMsg = document.getElementById('auth-msg');
    
    if (!email || !password) {
        authMsg.innerHTML = '<img src="assets/icons/triangle-alert.svg" class="icon-inline" alt="warn"> Veuillez remplir tous les champs';
        return;
    }
    
    if (password.length < 6) {
        authMsg.innerHTML = '<img src="assets/icons/triangle-alert.svg" class="icon-inline" alt="warn"> Le mot de passe doit contenir au moins 6 caractères';
        return;
    }
    
    authMsg.innerText = 'Création du compte...';
    authMsg.style.color = '#4CAF50';
    
    try {
        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password,
            options: {
                emailRedirectTo: window.location.origin + window.location.pathname
            }
        });
        
        if (error) throw error;
        
        // Create player record
        if (data.user) {
            await setPlayerDoc(data.user.id, {
                email: email,
                collection: [],
                packs_by_gen: {},
                last_draw_time: 0,
                available_packs: PACKS_PER_COOLDOWN,
                role: 'player',
                points: 0,
                bonus_packs: 0
            });
        }
        
        authMsg.innerText = '';
    } catch(e) {
        authMsg.style.color = '#ff6b6b';
        if (e.message.includes('already registered')) {
            authMsg.innerHTML = '<img src="assets/icons/triangle-alert.svg" class="icon-inline" alt="warn"> Cette adresse email est déjà utilisée';
        } else if (e.message.includes('invalid')) {
            authMsg.innerHTML = '<img src="assets/icons/triangle-alert.svg" class="icon-inline" alt="warn"> Adresse email invalide';
        } else if (e.message.includes('password')) {
            authMsg.innerHTML = '<img src="assets/icons/triangle-alert.svg" class="icon-inline" alt="warn"> Mot de passe trop faible';
        } else {
            authMsg.innerHTML = '<img src="assets/icons/triangle-alert.svg" class="icon-inline" alt="warn"> Erreur : ' + e.message;
        }
    }
};

window.signIn = async () => {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const authMsg = document.getElementById('auth-msg');
    
    if (!email || !password) {
        authMsg.innerHTML = '<img src="assets/icons/triangle-alert.svg" class="icon-inline" alt="warn"> Veuillez remplir tous les champs';
        return;
    }
    
    authMsg.innerText = 'Connexion...';
    authMsg.style.color = '#4CAF50';
    
    try {
        const { error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });
        
        if (error) throw error;
        authMsg.innerText = '';
    } catch(e) {
        authMsg.style.color = '#ff6b6b';
        if (e.message.includes('Invalid login credentials')) {
            authMsg.innerHTML = '<img src="assets/icons/triangle-alert.svg" class="icon-inline" alt="warn"> Email ou mot de passe incorrect';
        } else if (e.message.includes('Email not confirmed')) {
            authMsg.innerHTML = '<img src="assets/icons/triangle-alert.svg" class="icon-inline" alt="warn"> Veuillez confirmer votre email';
        } else {
            authMsg.innerHTML = '<img src="assets/icons/triangle-alert.svg" class="icon-inline" alt="warn"> Erreur : ' + e.message;
        }
    }
};
window.logout = () => supabase.auth.signOut();

// Toggle password visibility (button is non-tabbable via tabindex="-1")
window.togglePasswordVisibility = (btn) => {
    try {
        const input = document.getElementById('password');
        if (!input) return;
        if (input.type === 'password') {
            input.type = 'text';
            btn.innerHTML = '<img src="assets/icons/eye-closed.svg" class="title-icon" alt="masquer" style="filter: brightness(0) saturate(100%) invert(49%) sepia(0%) saturate(0%) hue-rotate(89deg) brightness(93%) contrast(95%);">';
            btn.setAttribute('aria-label', 'Masquer le mot de passe');
        } else {
            input.type = 'password';
            btn.innerHTML = '<img src="assets/icons/eye.svg" class="title-icon" alt="afficher" style="filter: brightness(0) saturate(100%) invert(49%) sepia(0%) saturate(0%) hue-rotate(89deg) brightness(93%) contrast(95%);">';
            btn.setAttribute('aria-label', 'Afficher le mot de passe');
        }
    } catch (e) {
        // silent
    }
};