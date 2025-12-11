import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, updateDoc, arrayUnion, getDoc, collection, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- 1. CONFIGURATION ---
const ADMIN_EMAIL = "bryan.drouet24@gmail.com"; 
const COOLDOWN_MINUTES = 5; 

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
const SESSION_ID = Date.now() + '_' + Math.random().toString(36);
let sessionCheckInterval = null;
let isBlocked = false;

async function checkSingleInstance(userId) {
    if (isBlocked) return;
    
    try {
        const sessionRef = doc(db, "sessions", userId);
        const sessionDoc = await getDoc(sessionRef);
        
        if (sessionDoc.exists()) {
            const data = sessionDoc.data();
            const now = Date.now();
            
            // Si la session existe et est active (moins de 10 secondes)
            if (data.sessionId !== SESSION_ID && (now - data.lastPing) < 10000) {
                isBlocked = true;
                clearInterval(sessionCheckInterval);
                document.body.innerHTML = `
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: #1a1a1a; color: white; text-align: center; padding: 20px;">
                        <h1 style="color: #ffde00; font-size: 3rem; margin-bottom: 20px;">⚠️ Instance Déjà Ouverte</h1>
                        <p style="font-size: 1.2rem; margin-bottom: 30px;">Votre compte est déjà connecté ailleurs.</p>
                        <p style="font-size: 1rem; color: #999;">Fermez l'autre instance pour continuer ici.</p>
                        <button onclick="location.reload()" style="margin-top: 30px; padding: 15px 30px; background: #ffde00; color: #1a1a1a; border: none; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 1rem;">Réessayer</button>
                    </div>
                `;
                return false;
            }
        }
        
        // Mettre à jour notre session
        await setDoc(sessionRef, {
            sessionId: SESSION_ID,
            lastPing: Date.now(),
            email: auth.currentUser?.email || 'unknown'
        });
        
        return true;
    } catch (error) {
        console.warn("Impossible de vérifier l'instance unique:", error.message);
        // Continuer sans vérification si les permissions manquent
        return true;
    }
}

async function startSessionMonitoring(userId) {
    // Vérification initiale
    const canContinue = await checkSingleInstance(userId);
    if (!canContinue) return false;
    
    // Vérifier toutes les 3 secondes
    sessionCheckInterval = setInterval(() => {
        checkSingleInstance(userId);
    }, 3000);
    
    // Nettoyer la session à la fermeture
    window.addEventListener('beforeunload', async () => {
        if (!isBlocked) {
            try {
                await setDoc(doc(db, "sessions", userId), {
                    sessionId: SESSION_ID,
                    lastPing: 0,
                    email: auth.currentUser?.email || 'unknown'
                });
            } catch (error) {
                // Ignorer les erreurs lors de la fermeture
            }
        }
    });
    
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
    dropRatesSixthCard: [ // Pour la 6ème carte : ni secrète, ni commune, ni uncommon
        { type: 'rare',       chance: 70,  filename: 'rare.json', label: "Rare", weight: 3 },
        { type: 'ultra_rare', chance: 30,  filename: 'ultra_rare.json', label: "Ultra Rare", weight: 4 }
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
        document.getElementById('popup-msg').innerText = msg;
        el.style.display = 'flex';
    } else {
        alert(title + "\n" + msg);
    }
};
window.closePopup = () => { 
    const el = document.getElementById('custom-popup-overlay');
    if(el) el.style.display = 'none'; 
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
        
        // Redirection admin au clic sur le profil
        const userProfilePill = document.getElementById('user-profile-pill');
        if(userProfilePill) {
            userProfilePill.onclick = () => {
                if(isAdmin) window.location.href = 'admin.html';
            };
        }

        // Check Notifications (Visuel uniquement)
        updateBellIcon();

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
        
        // Vérifier les notifications admin
        if (snap.exists() && snap.data().adminNotification) {
            const notif = snap.data().adminNotification;
            window.showPopup("Notification Admin", notif.message);
            // Supprimer la notification après affichage
            await updateDoc(doc(db, "players", user.uid), { adminNotification: null });
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
        } else {
            // Le compte n'existe pas en Firestore -> Recréer automatiquement
            console.log("Document joueur inexistant, création...");
            await setDoc(doc(db, "players", uid), {
                email: auth.currentUser.email,
                collection: [],
                lastDrawTime: 0,
                role: 'player'
            });
            userCollection = [];
            const countEl = document.getElementById('card-count');
            if(countEl) countEl.innerText = 0;
        }
    } catch (e) {
        console.error("Erreur chargement collection:", e);
        window.showPopup("Erreur", "Impossible de charger votre profil. Veuillez vous reconnecter.");
        await signOut(auth);
    }
}

// --- LOGIQUE CLASSEUR (BINDER) ---
window.changeGen = async () => {
    const genSelect = document.getElementById('gen-select');
    if(!genSelect) return;
    
    const gen = genSelect.value;
    const grid = document.getElementById('cards-grid');
    grid.innerHTML = '<div style="color:white; text-align:center; width:100%; padding:20px;">Chargement du classeur...</div>';

    currentGenData = []; // Reset des données locales
    
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
            case 'name':
                return a.name.localeCompare(b.name);
            case 'rarity-desc':
                return (rarityValues[b.rarityKey] || 0) - (rarityValues[a.rarityKey] || 0);
            case 'rarity-asc':
                return (rarityValues[a.rarityKey] || 0) - (rarityValues[b.rarityKey] || 0);
            case 'owned-desc':
                return b.ownedCopies - a.ownedCopies;
            case 'owned-asc':
                return a.ownedCopies - b.ownedCopies;
            case 'id':
            default:
                return a.id - b.id;
        }
    });

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
            
            const el = createCardElement(cardToRender, ownedCopies);
            
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

// Mode admin : afficher toutes les cartes
window.toggleAdminPreview = () => {
    const checkbox = document.getElementById('admin-show-all');
    adminShowAllMode = checkbox ? checkbox.checked : false;
    renderBinder();
};

// Création du HTML d'une carte (Compatible Pokémon & Events)
function createCardElement(card, quantity = 1) {
    const div = document.createElement('div');
    const mainType = card.types ? card.types[0] : 'Normal';
    const cssRarity = card.rarityKey ? card.rarityKey.replace('_', '-') : 'commune';
    
    const labels = {'common':'COMMUNE', 'uncommon':'PEU COM.', 'rare':'RARE', 'ultra_rare':'ULTRA RARE', 'secret':'SECRET'};
    const labelText = labels[card.rarityKey] || '';
    const label = quantity > 1 ? `${labelText}  |  x${quantity}` : labelText;
    
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
            <span class="card-name">${card.name}</span>
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

    btn.disabled = true;
    btn.innerHTML = "Génération...";

    try {
        tempBoosterCards = [];
        // 50% de chance d'avoir 4 ou 5 cartes
        const packSize = Math.random() < 0.5 ? 4 : 5;

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

            // Pioche avec limitation à 2 cartes identiques max
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
            
            tempBoosterCards.push(card);
        }

        // Animation d'ouverture
        openBoosterVisual();

        // Sauvegarde Firebase
        const updateData = { 
            collection: arrayUnion(...tempBoosterCards),
            currentBooster: tempBoosterCards, // Sauvegarde de l'ouverture en cours
            boosterRevealedCards: [] // Aucune carte révélée au départ
        };
        if (!isAdmin) updateData.lastDrawTime = Date.now();
        await updateDoc(doc(db, "players", user.uid), updateData);

        // Ajout à la collection locale
        userCollection.push(...tempBoosterCards);
        document.getElementById('card-count').innerText = userCollection.length;

        // Gestion Timer
        if (!isAdmin) startTimer(COOLDOWN_MINUTES * 60 * 1000);
        else { 
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
    
    container.innerHTML = '';
    closeBtn.style.display = 'none';
    overlay.style.display = 'flex';

    let cardsRevealed = alreadyRevealed.length;

    tempBoosterCards.forEach((card, index) => {
        const flipCard = document.createElement('div');
        flipCard.className = 'flip-card';
        // Petit délai pour l'effet de distribution
        flipCard.style.animationDelay = `${index * 0.1}s`;

        const inner = document.createElement('div');
        inner.className = 'flip-card-inner';

        const front = document.createElement('div');
        front.className = 'flip-card-front'; // Dos (Pokeball)
        
        const back = document.createElement('div');
        back.className = 'flip-card-back'; // Face (Carte)
        const cardEl = createCardElement(card);
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
                        await updateDoc(doc(db, "players", user.uid), {
                            boosterRevealedCards: alreadyRevealed
                        });
                    } catch (e) {
                        console.error("Erreur sauvegarde révélation:", e);
                    }
                }
                
                // Si tout est révélé, on montre le bouton OK
                if(cardsRevealed === tempBoosterCards.length) {
                    closeBtn.style.display = 'block';
                }
            }
        };

        container.appendChild(flipCard);
    });
    
    // Si toutes les cartes sont déjà révélées, afficher le bouton directement
    if (cardsRevealed === tempBoosterCards.length) {
        closeBtn.style.display = 'block';
    }
}

window.closeBooster = async () => {
    document.getElementById('booster-overlay').style.display = 'none';
    const btn = document.getElementById('btn-draw');
    
    // Nettoyer les données de booster en cours dans Firestore
    const user = auth.currentUser;
    if (user) {
        try {
            await updateDoc(doc(db, "players", user.uid), {
                currentBooster: [],
                boosterRevealedCards: []
            });
        } catch (e) {
            console.error("Erreur nettoyage booster:", e);
        }
    }
    
    // Réinitialiser les cartes temporaires
    tempBoosterCards = [];
    
    // Si admin, on réactive le bouton tout de suite
    if (auth.currentUser && auth.currentUser.email === ADMIN_EMAIL) {
        btn.disabled = false;
        btn.innerHTML = '<div class="booster-content">OUVRIR UN BOOSTER</div>';
    }
    
    // Recharger le binder pour montrer les nouvelles cartes
    renderBinder();
};

// --- COOLDOWN ---
async function checkCooldown(uid) {
    const snap = await getDoc(doc(db, "players", uid));
    if (snap.exists()) {
        const lastDraw = snap.data().lastDrawTime || 0;
        const diff = Date.now() - lastDraw;
        const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;
        
        if (diff < cooldownMs) startTimer(cooldownMs - diff);
        else enableBoosterButton(true);
    } else {
        enableBoosterButton(true);
    }
}

function startTimer(durationMs) {
    const btn = document.getElementById('btn-draw');
    const display = document.getElementById('cooldown-display');
    const val = document.getElementById('timer-val');
    
    btn.disabled = true;
    btn.classList.add('disabled');
    btn.innerHTML = `<div class="booster-content">RECHARGEMENT...</div>`;
    display.style.display = 'block';

    let remaining = durationMs;
    if (cooldownInterval) clearInterval(cooldownInterval);

    const tick = () => {
        remaining -= 1000;
        if (remaining <= 0) {
            clearInterval(cooldownInterval);
            enableBoosterButton(true);
            return;
        }
        const m = Math.floor((remaining / 1000 / 60) % 60);
        const s = Math.floor((remaining / 1000) % 60);
        val.innerText = `${m}:${s < 10 ? '0'+s : s}`;
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
window.requestNotification = async () => {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    updateBellIcon();
    if (permission === "granted") {
        new Notification("Poké-TCG", { body: "Notifications activées !", icon: "icons/fire.svg" });
    }
};

function updateBellIcon() {
    const bell = document.getElementById('notif-bell');
    if (Notification.permission === "granted") bell.classList.add('bell-active');
    else bell.classList.remove('bell-active');
}

// --- AUTH HELPERS ---
window.googleLogin = async () => {
    try {
        await signInWithPopup(auth, provider);
    } catch(e) {
        // En local, cette erreur peut arriver mais la connexion réussit souvent quand même
        console.warn("Popup error:", e);
    }
};
window.signUp = async () => { authUser(createUserWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value)); };
window.signIn = async () => { try { await signInWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value); } catch(e) { window.showPopup("Erreur", e.message); } };
window.logout = () => signOut(auth);
async function authUser(promise) { try { const res = await promise; const ref = doc(db, "players", res.user.uid); const snap = await getDoc(ref); if (!snap.exists()) await setDoc(ref, { email: res.user.email, collection: [], lastDrawTime: 0 }); } catch (e) { console.error(e); } }