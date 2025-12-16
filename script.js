import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, updateDoc, arrayUnion, getDoc, collection, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- ENREGISTREMENT SERVICE WORKER (PWA) ---
let deferredPrompt = null;

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('Service Worker enregistré:', registration.scope);
            })
            .catch(error => {
                console.log('Erreur Service Worker:', error);
            });
    });
}

// Capture l'événement d'installation PWA
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    // Afficher le bouton d'installation
    const installBtn = document.getElementById('install-pwa-btn');
    if (installBtn) {
        installBtn.style.display = 'inline-block';
    }
});

// Fonction d'installation PWA
window.installPWA = async function() {
    if (!deferredPrompt) return;
    
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
        console.log('PWA installée');
    }
    
    deferredPrompt = null;
    const installBtn = document.getElementById('install-pwa-btn');
    if (installBtn) {
        installBtn.style.display = 'none';
    }
};

// Cacher le bouton si déjà installé
window.addEventListener('appinstalled', () => {
    const installBtn = document.getElementById('install-pwa-btn');
    if (installBtn) {
        installBtn.style.display = 'none';
    }
    deferredPrompt = null;
});

// --- 1. CONFIGURATION ---
const ADMIN_EMAIL = "bryan.drouet24@gmail.com"; 
const COOLDOWN_MINUTES = 7;
const PACKS_PER_COOLDOWN = 3;
const POINTS_PER_CARD = 1;
const POINTS_FOR_BONUS_PACK = 30;
const BOOSTER_DELAY_SECONDS = 3; 

// TA CONFIG FIREBASE (Celle que tu m'as donnée)
const firebaseConfig = {
    apiKey: "AIzaSyBdtS508E3KBTZHfOTb7kl-XDc9vVn3oZI",
    authDomain: "tcgp-27e34.firebaseapp.com",
    projectId: "tcgp-27e34",
    storageBucket: "tcgp-27e34.firebasestorage.app",
    messagingSenderId: "7412987658",
    appId: "1:7412987658:web:87f0a63b9b7c95548bacf3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

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
    { id: "special_bryan", name: "🌟 Pack Spécial Bryan" }
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
        msgEl.innerHTML = msg.replace(/\n/g, '<br>');
        msgEl.style.textAlign = 'left';
        msgEl.style.whiteSpace = 'pre-line';
        el.style.display = 'flex';
    } else {
        alert(title + "\n" + msg.replace(/<[^>]*>/g, ''));
    }
};
window.closePopup = () => { 
    const el = document.getElementById('custom-popup-overlay');
    if(el) el.style.display = 'none'; 
};

// --- MENU PROFIL ---
function showProfileMenu() {
    const menuHtml = `
        <div style="display: flex; flex-direction: column; gap: 15px;">
            <button onclick="logout()" class="btn-secondary" style="width: 100%;">🚪 Déconnexion
            </button>
            <button onclick="resetAccount()" class="btn-secondary" style="width: 100%;">🔄 Réinitialiser mon compte
            </button>
            <button onclick="deleteAccount()" class="btn-tertiary" style="width: 100%; background: var(--danger); border-color: #a82929; box-shadow: 0 4px 0 #a82929;">❌ Supprimer mon compte
            </button>
        </div>
    `;
    
    const popup = document.getElementById('custom-popup-overlay');
    const title = document.getElementById('popup-title');
    const msg = document.getElementById('popup-content') || document.getElementById('popup-msg');
    
    title.innerText = "👤 MON PROFIL";
    msg.innerHTML = menuHtml;
    popup.style.display = 'flex';
}

window.resetAccount = async () => {
    if (!confirm('⚠️ Êtes-vous sûr de vouloir réinitialiser votre compte ? Toutes vos cartes seront supprimées !')) {
        return;
    }
    
    const user = auth.currentUser;
    if (!user) return;
    
    try {
        await setDoc(doc(db, "players", user.uid), {
            collection: [],
            packsByGen: {},
            currentBooster: [],
            boosterRevealedCards: []
        }, { merge: true });
        
        closePopup();
        window.showPopup("✅ Compte réinitialisé", "Votre compte a été réinitialisé avec succès. Rechargez la page.");
        setTimeout(() => location.reload(), 2000);
    } catch (e) {
        window.showPopup("Erreur", "Impossible de réinitialiser le compte: " + e.message);
    }
};

window.deleteAccount = async () => {
    if (!confirm('⚠️ ATTENTION ! Voulez-vous vraiment SUPPRIMER COMPLÈTEMENT votre compte ? Cette action est IRRÉVERSIBLE !')) {
        return;
    }
    
    if (!confirm('❌ Dernière confirmation : Supprimer définitivement votre compte ?')) {
        return;
    }
    
    const user = auth.currentUser;
    if (!user) return;
    
    try {
        // Supprimer les données Firestore
        await deleteDoc(doc(db, "players", user.uid));
        await deleteDoc(doc(db, "sessions", user.uid));
        
        // Supprimer le compte Firebase Auth
        await user.delete();
        
        closePopup();
        window.showPopup("✅ Compte supprimé", "Votre compte a été supprimé avec succès.");
        setTimeout(() => location.reload(), 2000);
    } catch (e) {
        if (e.code === 'auth/requires-recent-login') {
            window.showPopup("Erreur", "Vous devez vous reconnecter récemment pour supprimer votre compte. Déconnectez-vous et reconnectez-vous, puis réessayez.");
        } else {
            window.showPopup("Erreur", "Impossible de supprimer le compte: " + e.message);
        }
    }
};

// --- GESTION QUANTITÉ DE PACKS ---
window.updatePackQuantity = async () => {
    const select = document.getElementById('pack-quantity');
    const btn = document.getElementById('btn-draw');
    const quantity = parseInt(select.value);
    const user = auth.currentUser;
    const isAdmin = user && (user.email === ADMIN_EMAIL);
    
    // Vérifier si l'utilisateur a assez de packs
    let availablePacks = PACKS_PER_COOLDOWN;
    if (user && !isAdmin && btn) {
        const genSelect = document.getElementById('gen-select');
        const selectedGen = genSelect.value;
        
        try {
            const snap = await getDoc(doc(db, "players", user.uid));
            if (snap.exists()) {
                const packsByGen = snap.data().packsByGen || {};
                const genData = packsByGen[selectedGen] || { availablePacks: PACKS_PER_COOLDOWN };
                availablePacks = genData.availablePacks ?? PACKS_PER_COOLDOWN;
                
                // Désactiver le bouton si pas assez de packs, sinon le réactiver
                if (availablePacks < quantity) {
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
    
    // Toujours mettre à jour le texte du bouton (sauf si en mode PATIENTEZ)
    if (btn && !btn.innerHTML.includes('PATIENTEZ') && !btn.innerHTML.includes('⏳')) {
        if (quantity > 1) {
            btn.innerHTML = `<div class="booster-content">OUVRIR ${quantity} BOOSTERS</div>`;
        } else {
            btn.innerHTML = '<div class="booster-content">OUVRIR UN BOOSTER</div>';
        }
    }
    
    // Mettre à jour l'affichage du nombre de packs disponibles
    const packsInfo = document.getElementById('packs-info');
    if (packsInfo && user && !isAdmin) {
        packsInfo.textContent = `(${availablePacks}/${PACKS_PER_COOLDOWN} disponibles)`;
    }
};

// --- AFFICHAGE DES PROBABILITÉS ---
window.showDropRates = () => {
    const packInfo = `
<h3>🎁 SYSTÈME DE PACKS :</h3>
• Vous disposez de 3 packs maximum par génération
• Les 3 packs se régénèrent toutes les ${COOLDOWN_MINUTES} minutes
• Vous pouvez ouvrir plusieurs packs d'un coup
• Chaque génération a son propre cooldown indépendant

<h3>🎲 TAILLE DU PACK :</h3>
• 75% de chance d'obtenir 4 cartes
• 25% de chance d'obtenir 5 cartes

<h3>📊 PROBABILITÉS DE RARETÉ (Cartes 1-4) :</h3>
• ⚪ Commune : 56%
• 🟢 Peu Commune : 26%
• 🔵 Rare : 14%
• 🟣 Ultra Rare : 3.8%
• ⭐ Secrète : 0.2%

<h3>✨ 5ème CARTE (si pack de 5) :</h3>
• 🔵 Rare : 68%
• 🟣 Ultra Rare : 30%
• ⭐ Secrète : 2%
(Pas de commune ou peu commune)

<h3>🚫 LIMITE :</h3>
Maximum 2 cartes identiques par pack
    `.trim();
    
    window.showPopup("🎮 SYSTÈME DE DROP", packInfo);
};

// --- AUTHENTIFICATION ---
onAuthStateChanged(auth, async (user) => {
    const loader = document.getElementById('global-loader');
    
    if (user) {
        // Vérifier l'instance unique
        const canContinue = await startSessionMonitoring(user.uid);
        if (!canContinue) return;
        
        // Connecté
        document.getElementById('auth-overlay').style.display = 'none';
        document.getElementById('game-app').style.display = 'block';
        document.getElementById('user-display').innerText = user.email.split('@')[0];
        
        // Vérif Admin (Basique sur email)
        const isAdmin = (user.email === ADMIN_EMAIL);
        const adminPreview = document.getElementById('admin-preview-container');
        if(adminPreview) adminPreview.style.display = isAdmin ? 'block' : 'none';
        
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



        // 1. Charger la collection
        await fetchUserCollection(user.uid);
        
        // 2. Vérifier si un booster est en cours d'ouverture
        const snap = await getDoc(doc(db, "players", user.uid));
        if (snap.exists() && snap.data().currentBooster && snap.data().currentBooster.length > 0) {
            // Restaurer l'ouverture en cours
            tempBoosterCards = snap.data().currentBooster;
            const revealedCards = snap.data().boosterRevealedCards || [];
            openBoosterVisual(revealedCards);
        }
        

        
        // 3. Charger le classeur (Gen par défaut)
        await changeGen(); 

        // 4. Vérifier le Cooldown
        if (!isAdmin) await checkCooldown(user.uid);
        else enableBoosterButton(true);

        // Fin du chargement
        if(loader) loader.style.display = 'none';

    } else {
        // Déconnecté
        document.getElementById('game-app').style.display = 'none';
        document.getElementById('auth-overlay').style.display = 'flex';
        if(cooldownInterval) clearInterval(cooldownInterval);
        if(loader) loader.style.display = 'none';
    }
});

// Récupérer la collection depuis Firebase
async function fetchUserCollection(uid) {
    try {
        const snap = await getDoc(doc(db, "players", uid));
        if (snap.exists()) {
            userCollection = snap.data().collection || [];
            const countEl = document.getElementById('card-count');
            if(countEl) countEl.innerText = userCollection.length;
            
            // Mettre à jour l'affichage des points
            updatePointsDisplay();
        } else {
            // Le compte n'existe pas en Firestore -> Recréer automatiquement
            console.log("Document joueur inexistant, création...");
            await setDoc(doc(db, "players", uid), {
                email: auth.currentUser.email,
                collection: [],
                lastDrawTime: 0,
                availablePacks: PACKS_PER_COOLDOWN,
                role: 'player',
                points: 0,
                bonusPacks: 0
            });
            userCollection = [];
            const countEl = document.getElementById('card-count');
            if(countEl) countEl.innerText = 0;
            updatePointsDisplay();
        }
    } catch (e) {
        console.error("Erreur chargement collection:", e);
        window.showPopup("Erreur", "Impossible de charger votre profil. Veuillez vous reconnecter.");
        await signOut(auth);
    }
}

// Fonction pour afficher les points et bonus packs
async function updatePointsDisplay() {
    const user = auth.currentUser;
    if (!user) return;
    
    const snap = await getDoc(doc(db, "players", user.uid));
    if (!snap.exists()) return;
    
    const data = snap.data();
    const genSelect = document.getElementById('gen-select');
    const currentGen = genSelect ? genSelect.value : 'gen7';
    
    // Récupérer les données de la génération active
    const packsByGen = data.packsByGen || {};
    const genData = packsByGen[currentGen] || { points: 0, bonusPacks: 0 };
    const points = genData.points || 0;
    const bonusPacks = genData.bonusPacks || 0;
    
    // Mettre à jour la valeur des points
    const pointsValueEl = document.getElementById('points-value');
    if (pointsValueEl) {
        pointsValueEl.textContent = `${points}/${POINTS_FOR_BONUS_PACK}`;
    }
    
    // Mettre à jour la barre de progression
    const progressFillEl = document.getElementById('points-progress-fill');
    if (progressFillEl) {
        const percentage = (points / POINTS_FOR_BONUS_PACK) * 100;
        progressFillEl.style.width = `${percentage}%`;
    }
    
    // Afficher/masquer la section des bonus packs
    const bonusInfoEl = document.getElementById('bonus-packs-info');
    const bonusCountEl = document.getElementById('bonus-packs-count');
    const bonusPluralEl = document.getElementById('bonus-plural');
    
    if (bonusInfoEl && bonusCountEl) {
        if (bonusPacks > 0) {
            bonusInfoEl.style.display = 'block';
            bonusCountEl.textContent = bonusPacks;
            if (bonusPluralEl) {
                bonusPluralEl.textContent = bonusPacks > 1 ? 's' : '';
            }
        } else {
            bonusInfoEl.style.display = 'none';
        }
    }
}

// Fonction pour utiliser un bonus pack
window.useBonusPack = async () => {
    const user = auth.currentUser;
    if (!user) return;
    
    const snap = await getDoc(doc(db, "players", user.uid));
    if (!snap.exists()) return;
    
    const data = snap.data();
    const genSelect = document.getElementById('gen-select');
    const currentGen = genSelect ? genSelect.value : 'gen7';
    
    // Récupérer les données de la génération active
    const packsByGen = data.packsByGen || {};
    const genData = packsByGen[currentGen] || { points: 0, bonusPacks: 0 };
    const bonusPacks = genData.bonusPacks || 0;
    
    if (bonusPacks <= 0) {
        window.showPopup("Pas de bonus", "Vous n'avez pas de booster bonus disponible pour cette génération.");
        return;
    }
    
    // Décrémenter le bonus pack pour cette génération
    packsByGen[currentGen] = {
        ...genData,
        bonusPacks: bonusPacks - 1
    };
    
    await setDoc(doc(db, "players", user.uid), {
        packsByGen: packsByGen
    }, { merge: true });
    
    // Mettre à jour l'affichage
    updatePointsDisplay();
    
    // Ouvrir un booster
    drawCard();
}

// Fonction pour ouvrir la boutique
window.openShop = async () => {
    const user = auth.currentUser;
    if (!user) return;
    
    const snap = await getDoc(doc(db, "players", user.uid));
    if (!snap.exists()) return;
    
    const data = snap.data();
    const genSelect = document.getElementById('gen-select');
    const currentGen = genSelect ? genSelect.value : 'gen7';
    const packsByGen = data.packsByGen || {};
    const genData = packsByGen[currentGen] || { points: 0, bonusPacks: 0 };
    const points = genData.points || 0;
    const bonusPacks = genData.bonusPacks || 0;
    
    const shopHtml = `
        <div style="text-align: center;">
            <div style="font-size: 3rem; margin: 20px 0;">🎁</div>
            <div style="font-size: 1.2rem; margin-bottom: 20px;">
                <strong>Vos points :</strong> ${points}/${POINTS_FOR_BONUS_PACK}<br>
                <strong>Boosters bonus disponibles :</strong> ${bonusPacks}
            </div>
            <div style="background: rgba(0,0,0,0.3); padding: 15px; border-radius: 10px; margin: 20px 0;">
                <p style="margin: 10px 0;">💎 Chaque carte obtenue vous donne <strong>${POINTS_PER_CARD} point</strong></p>
                <p style="margin: 10px 0;">🎁 Chaque fois que vous atteignez <strong>${POINTS_FOR_BONUS_PACK} points</strong>, vous gagnez un booster bonus</p>
                <p style="margin: 10px 0;">✨ Les points excédentaires sont conservés pour le prochain booster</p>
            </div>
            <div style="background: rgba(59, 76, 202, 0.2); padding: 15px; border-radius: 10px; margin-top: 15px; border: 2px solid rgba(59, 76, 202, 0.5);">
                <p style="color: var(--secondary); font-weight: bold; margin-bottom: 10px;">📊 Progression actuelle</p>
                <div style="width: 100%; height: 30px; background: rgba(0,0,0,0.4); border-radius: 15px; overflow: hidden; margin: 10px 0;">
                    <div style="height: 100%; width: ${(points / POINTS_FOR_BONUS_PACK) * 100}%; background: linear-gradient(90deg, #FFD700 0%, #FFA500 100%); border-radius: 15px; transition: width 0.5s ease;"></div>
                </div>
                <p style="color: #ccc; font-size: 0.9rem;">${points} / ${POINTS_FOR_BONUS_PACK} points</p>
            </div>
            ${bonusPacks > 0 ? `
                <button onclick="closePopup(); useBonusPack();" class="btn-primary" style="width: 100%; padding: 15px; margin-top: 20px; font-size: 1.1rem;">
                    🎁 Utiliser un booster bonus (${bonusPacks} disponible${bonusPacks > 1 ? 's' : ''})
                </button>
            ` : `
                <p style="color: #999; margin-top: 20px;">Collectionnez plus de cartes pour gagner des boosters bonus !</p>
            `}
        </div>
    `;
    
    window.showPopup("🛒 BOUTIQUE", shopHtml);
}

// --- LOGIQUE CLASSEUR (BINDER) ---
window.changeGen = async () => {
    const genSelect = document.getElementById('gen-select');
    if(!genSelect) return;
    
    const gen = genSelect.value;
    const grid = document.getElementById('cards-grid');
    grid.innerHTML = '<div style="color:white; text-align:center; width:100%; padding:20px;">Chargement du classeur...</div>';

    currentGenData = []; // Reset des données locales
    
    // Vérifier le cooldown de cette génération
    const user = auth.currentUser;
    if (user && user.email !== ADMIN_EMAIL) {
        await checkCooldown(user.uid);
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
    
    const searchInput = document.getElementById('search-input');
    const searchTerm = searchInput ? searchInput.value.toLowerCase() : "";
    
    const sortSelect = document.getElementById('sort-select');
    const sortType = sortSelect ? sortSelect.value : 'id';
    
    const showOwned = document.getElementById('show-owned');
    const showMissing = document.getElementById('show-missing');
    const displayOwned = showOwned ? showOwned.checked : true;
    const displayMissing = showMissing ? showMissing.checked : true;

    // Préparer les données avec quantité possédée (ou mode admin)
    const cardsWithOwned = currentGenData.map(cardRef => {
        const ownedCopies = adminShowAllMode ? 1 : userCollection.filter(c => c.id === cardRef.id).length;
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
        
        // Ne pas montrer les secrètes non possédées
        if (!isOwned && cardRef.rarityKey === 'secret') return false;
        
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
            const ownedCount = adminShowAllMode ? 1 : userCollection.filter(c => c.id === cardRef.id).length;
            if (ownedCount > 0) rarityStats[rarity].owned++;
        }
    });
    
    // Afficher les stats
    const statsContainer = document.getElementById('rarity-stats');
    if (statsContainer) {
        const labels = {
            common: { emoji: '⚪', name: 'Communes' },
            uncommon: { emoji: '🟢', name: 'Peu Com.' },
            rare: { emoji: '🔵', name: 'Rares' },
            ultra_rare: { emoji: '🟣', name: 'Ultra Rares' },
            secret: { emoji: '⭐', name: 'Secrètes' }
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
        let badgesHtml = `<div class="rarity-stat-badge ${totalOwned === totalCards ? 'complete' : 'incomplete'}" 
            onclick="toggleRarityFilter(null)" 
            style="cursor: pointer; ${selectedRarityFilter === null ? 'box-shadow: 0 0 15px rgba(255, 222, 0, 0.8); transform: scale(1.05);' : ''}">
            <span class="emoji">🎯</span>
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
                return `<div class="rarity-stat-badge ${isComplete ? 'complete' : 'incomplete'}" 
                    onclick="toggleRarityFilter('${rarity}')" 
                    style="cursor: pointer; ${isSelected ? 'box-shadow: 0 0 15px rgba(255, 222, 0, 0.8); transform: scale(1.05);' : ''}" 
                    title="Cliquez pour filtrer">
                    <span class="emoji">${label.emoji}</span>
                    <span>${label.name}: ${stats.owned}/${stats.total}</span>
                    <span class="percent">(${percent}%)</span>
                </div>`;
            })
            .join('');
            
        statsContainer.innerHTML = badgesHtml;
    }
    
    // Message si aucun résultat
    if (filteredCards.length === 0) {
        grid.innerHTML = '<div style="color: #999; text-align: center; width: 100%; padding: 40px; font-size: 1.2rem;">❌ Aucune carte ne correspond aux filtres</div>';
        return;
    }

    filteredCards.forEach(cardRef => {
        const ownedCopies = cardRef.ownedCopies;
        
        if (ownedCopies > 0) {
            // --- CARTE POSSÉDÉE ---
            // En mode admin, on utilise cardRef directement
            // Sinon on cherche dans la collection utilisateur
            const userCard = adminShowAllMode ? cardRef : userCollection.find(c => c.id === cardRef.id);
            // On force la rareté correcte (au cas où)
            const cardToRender = userCard ? { ...userCard, rarityKey: cardRef.rarityKey } : cardRef;
            
            // Calculer le total de cartes de cette génération
            const totalCards = currentGenData.length;
            
            const el = createCardElement(cardToRender, ownedCopies, cardRef.displayId, totalCards);
            
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
}

// Fonction appelée par la barre de recherche
window.filterBinder = () => {
    renderBinder();
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
};

// Mode admin : afficher toutes les cartes
window.toggleAdminPreview = () => {
    const checkbox = document.getElementById('admin-show-all');
    adminShowAllMode = checkbox ? checkbox.checked : false;
    renderBinder();
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
    const retreatCircles = '⚪'.repeat(card.retreatCost || 0) || '-';

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
window.drawCard = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const isAdmin = (user.email === ADMIN_EMAIL);
    const btn = document.getElementById('btn-draw');
    
    // Sécurité anti-clic
    if (!isAdmin && btn.disabled) return;

    const genSelect = document.getElementById('gen-select');
    const selectedGen = genSelect.value;
    
    // Récupérer la quantité de packs à ouvrir
    const packQuantitySelect = document.getElementById('pack-quantity');
    const packQuantity = parseInt(packQuantitySelect.value);
    
    // Vérifier si l'utilisateur a assez de packs disponibles
    if (!isAdmin) {
        const snap = await getDoc(doc(db, "players", user.uid));
        if (snap.exists()) {
            const packsByGen = snap.data().packsByGen || {};
            const genData = packsByGen[selectedGen] || { availablePacks: PACKS_PER_COOLDOWN };
            const availablePacks = genData.availablePacks ?? PACKS_PER_COOLDOWN;
            
            if (availablePacks < packQuantity) {
                window.showPopup("Pas assez de packs", `Vous voulez ouvrir ${packQuantity} pack(s) mais vous n'en avez que ${availablePacks} disponible(s) pour cette génération.`);
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
                
                for (const r of rates) {
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
            collection: arrayUnion(...tempBoosterCards),
            currentBooster: tempBoosterCards, // Sauvegarde de l'ouverture en cours
            boosterRevealedCards: [] // Aucune carte révélée au départ
        };
        
        // Récupérer les données actuelles une seule fois
        const currentSnap = await getDoc(doc(db, "players", user.uid));
        const currentData = currentSnap.exists() ? currentSnap.data() : {};
        const packsByGen = currentData.packsByGen || {};
        const genData = packsByGen[selectedGen] || { availablePacks: PACKS_PER_COOLDOWN, lastDrawTime: 0, points: 0, bonusPacks: 0 };
        
        if (!isAdmin) {
            // Décrémenter les packs disponibles pour cette génération
            let availablePacks = genData.availablePacks ?? PACKS_PER_COOLDOWN;
            availablePacks = Math.max(0, availablePacks - packQuantity);
            genData.availablePacks = availablePacks;
            genData.lastDrawTime = Date.now();
        }
        
        // Calculer les points gagnés
        const cardsCount = tempBoosterCards.length;
        const pointsGained = cardsCount * POINTS_PER_CARD;
        
        const currentPoints = genData.points || 0;
        const currentBonusPacks = genData.bonusPacks || 0;
        
        // Calculer nouveaux points et bonus packs pour cette génération
        const totalPoints = currentPoints + pointsGained;
        const earnedBonusPacks = Math.floor(totalPoints / POINTS_FOR_BONUS_PACK);
        const remainingPoints = totalPoints % POINTS_FOR_BONUS_PACK;
        
        // Mettre à jour les données de cette génération (conserve availablePacks et lastDrawTime)
        packsByGen[selectedGen] = {
            ...genData,
            points: remainingPoints,
            bonusPacks: currentBonusPacks + earnedBonusPacks
        };
        
        updateData.packsByGen = packsByGen;
        
        // Utiliser setDoc avec merge pour créer le document s'il n'existe pas
        await setDoc(doc(db, "players", user.uid), updateData, { merge: true });

        // Ajout à la collection locale
        userCollection.push(...tempBoosterCards);
        document.getElementById('card-count').innerText = userCollection.length;
        
        // Mettre à jour l'affichage des points
        updatePointsDisplay();
        
        // Mettre à jour l'affichage du nombre de packs disponibles
        await updatePackQuantity();
        
        // Afficher un message si un booster bonus a été gagné
        if (earnedBonusPacks > 0) {
            window.showPopup("🎁 Booster Bonus!", `Vous avez gagné ${earnedBonusPacks} booster(s) bonus avec vos points !`);
        }

        // Gestion Timer
        if (!isAdmin) {
            // Si plus de packs disponibles pour cette génération, démarrer le timer
            const snap = await getDoc(doc(db, "players", user.uid));
            if (snap.exists()) {
                const packsByGen = snap.data().packsByGen || {};
                const genData = packsByGen[selectedGen] || { availablePacks: 0 };
                const availablePacks = genData.availablePacks ?? 0;
                
                if (availablePacks === 0) {
                    startTimer(COOLDOWN_MINUTES * 60 * 1000, user.uid);
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
    closeBtn.style.display = 'none';
    revealAllBtn.style.display = 'inline-block';
    overlay.style.display = 'flex';
    
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
        title.innerHTML = `CLIQUEZ POUR RÉVÉLER ! <span style="color: var(--secondary); margin-left: 15px;">(${cardsOwned}/${tempBoosterCards.length} possédées)</span>`;
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

        // Adapter la hauteur du dos de carte après le chargement de l'image
        setTimeout(() => {
            const cardHeight = cardEl.offsetHeight;
            if (cardHeight > 0) {
                front.style.height = cardHeight + 'px';
            }
        }, 100);

        // Click pour retourner
        flipCard.onclick = async () => {
            if(!flipCard.classList.contains('flipped')) {
                flipCard.classList.add('flipped');
                cardsRevealed++;
                
                // Sauvegarder la carte révélée dans Firestore
                alreadyRevealed.push(index);
                const user = auth.currentUser;
                if (user) {
                    try {
                        await setDoc(doc(db, "players", user.uid), {
                            boosterRevealedCards: alreadyRevealed
                        }, { merge: true });
                    } catch (e) {
                        console.error("Erreur sauvegarde révélation:", e);
                    }
                }
                
                // Si tout est révélé, on montre le bouton OK
                if(cardsRevealed === tempBoosterCards.length) {
                    closeBtn.style.display = 'block';
                    document.getElementById('reveal-all-btn').style.display = 'none';
                }
            }
        };

        container.appendChild(flipCard);
    });
    
    // Si toutes les cartes sont déjà révélées, afficher le bouton directement
    if (cardsRevealed === tempBoosterCards.length) {
        closeBtn.style.display = 'block';
        document.getElementById('reveal-all-btn').style.display = 'none';
    }
}

// Révéler toutes les cartes d'un coup
window.revealAllCards = async () => {
    const flipCards = document.querySelectorAll('.flip-card:not(.flipped)');
    const user = auth.currentUser;
    
    flipCards.forEach((card, index) => {
        setTimeout(() => {
            card.classList.add('flipped');
        }, index * 100); // Animation en cascade
    });
    
    // Sauvegarder toutes les cartes comme révélées
    if (user) {
        try {
            const allIndices = Array.from({length: tempBoosterCards.length}, (_, i) => i);
            await setDoc(doc(db, "players", user.uid), {
                boosterRevealedCards: allIndices
            }, { merge: true });
        } catch (e) {
            console.error("Erreur sauvegarde révélation complète:", e);
        }
    }
    
    // Afficher les boutons
    setTimeout(() => {
        document.getElementById('close-booster-btn').style.display = 'block';
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
    const user = auth.currentUser;
    if (user) {
        try {
            await setDoc(doc(db, "players", user.uid), {
                currentBooster: [],
                boosterRevealedCards: []
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
            await checkCooldown(user.uid);
        }
    }
    
    // Réinitialiser les cartes temporaires
    tempBoosterCards = [];
    
    // Recharger le binder pour montrer les nouvelles cartes
    renderBinder();
};

// --- COOLDOWN PAR GÉNÉRATION ---
async function checkCooldown(uid) {
    const genSelect = document.getElementById('gen-select');
    const currentGen = genSelect ? genSelect.value : 'gen7';
    
    const snap = await getDoc(doc(db, "players", uid));
    if (snap.exists()) {
        const data = snap.data();
        const packsByGen = data.packsByGen || {};
        const genData = packsByGen[currentGen] || { availablePacks: PACKS_PER_COOLDOWN, lastDrawTime: 0 };
        
        let availablePacks = genData.availablePacks ?? PACKS_PER_COOLDOWN;
        const lastDraw = genData.lastDrawTime || 0;
        
        const diff = Date.now() - lastDraw;
        const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;
        
        // Si le cooldown est passé, régénérer TOUS les packs
        const wasZero = availablePacks === 0;
        if (diff >= cooldownMs) {
            availablePacks = PACKS_PER_COOLDOWN;
            
            // Mettre à jour Firebase pour cette génération
            packsByGen[currentGen] = {
                availablePacks: PACKS_PER_COOLDOWN,
                lastDrawTime: genData.lastDrawTime
            };
            
            await setDoc(doc(db, "players", uid), { 
                packsByGen: packsByGen
            }, { merge: true });
        }
        
        if (availablePacks > 0) {
            enableBoosterButton(true);
            // Vérifier si on peut ouvrir le nombre de packs sélectionné
            await updatePackQuantity();
        } else {
            // Calculer le temps restant avant la régénération complète
            const timeToNextPack = cooldownMs - diff;
            startTimer(timeToNextPack, uid);
            // Mettre à jour quand même l'affichage des packs (0)
            await updatePackQuantity();
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
            // Re-vérifier les packs disponibles
            if (uid) checkCooldown(uid);
            else enableBoosterButton(true);
            return;
        }
        const m = Math.floor((remaining / 1000 / 60) % 60);
        const s = Math.floor((remaining / 1000) % 60);
        btn.innerHTML = `<div class="booster-content">⏳ Prochain dans ${m}:${s < 10 ? '0'+s : s}</div>`;
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

// --- NOTIFICATIONS SUPPRIMÉES ---

// --- AUTH HELPERS ---
window.googleLogin = async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch(e) {
        // En local, cette erreur peut arriver mais la connexion réussit souvent quand même
        console.warn("Popup error:", e);
    }
};
window.signUp = async () => {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const authMsg = document.getElementById('auth-msg');
    
    if (!email || !password) {
        authMsg.innerText = '⚠️ Veuillez remplir tous les champs';
        return;
    }
    
    if (password.length < 6) {
        authMsg.innerText = '⚠️ Le mot de passe doit contenir au moins 6 caractères';
        return;
    }
    
    authMsg.innerText = 'Création du compte...';
    authMsg.style.color = '#4CAF50';
    
    try {
        await authUser(createUserWithEmailAndPassword(auth, email, password));
        authMsg.innerText = '';
    } catch(e) {
        authMsg.style.color = '#ff6b6b';
        if (e.code === 'auth/email-already-in-use') {
            authMsg.innerText = '⚠️ Cette adresse email est déjà utilisée';
        } else if (e.code === 'auth/invalid-email') {
            authMsg.innerText = '⚠️ Adresse email invalide';
        } else if (e.code === 'auth/weak-password') {
            authMsg.innerText = '⚠️ Mot de passe trop faible';
        } else {
            authMsg.innerText = '⚠️ Erreur : ' + e.message;
        }
    }
};

window.signIn = async () => {
    const email = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const authMsg = document.getElementById('auth-msg');
    
    if (!email || !password) {
        authMsg.innerText = '⚠️ Veuillez remplir tous les champs';
        return;
    }
    
    authMsg.innerText = 'Connexion...';
    authMsg.style.color = '#4CAF50';
    
    try {
        await signInWithEmailAndPassword(auth, email, password);
        authMsg.innerText = '';
    } catch(e) {
        authMsg.style.color = '#ff6b6b';
        if (e.code === 'auth/user-not-found') {
            authMsg.innerText = '⚠️ Aucun compte trouvé avec cet email';
        } else if (e.code === 'auth/wrong-password') {
            authMsg.innerText = '⚠️ Mot de passe incorrect';
        } else if (e.code === 'auth/invalid-email') {
            authMsg.innerText = '⚠️ Adresse email invalide';
        } else if (e.code === 'auth/invalid-credential') {
            authMsg.innerText = '⚠️ Email ou mot de passe incorrect';
        } else {
            authMsg.innerText = '⚠️ Erreur : ' + e.message;
        }
    }
};
window.logout = () => signOut(auth);

async function authUser(promise) {
    try {
        const res = await promise;
        const ref = doc(db, "players", res.user.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
            await setDoc(ref, {
                email: res.user.email,
                collection: [],
                packsByGen: {},
                lastDrawTime: 0,
                availablePacks: PACKS_PER_COOLDOWN,
                points: 0,
                bonusPacks: 0
            });
        }
    } catch (e) {
        console.error('Auth error:', e);
        throw e; // Propager l'erreur pour qu'elle soit gérée par signUp
    }
}