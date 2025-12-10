import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, updateDoc, arrayUnion, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const ADMIN_EMAIL = "bryan.drouet24@gmail.com"; 
const COOLDOWN_MINUTES = 5; 

// CONFIG FIREBASE (Gardée telle quelle)
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

// Liste des Gens
const GEN_LIST = [
    { id: "gen1", name: "Gen 1 - Kanto" },
    { id: "gen2", name: "Gen 2 - Johto" },
    { id: "gen3", name: "Gen 3 - Hoenn" },
    { id: "gen4", name: "Gen 4 - Sinnoh" },
    { id: "gen5", name: "Gen 5 - Unys" },
    { id: "gen6", name: "Gen 6 - Kalos" },
    { id: "gen7", name: "Gen 7 - Alola" }
];

const GAME_CONFIG = {
    dropRates: [
        { type: 'common',     chance: 55,  filename: 'common.json', label: "Commune", weight: 1 },
        { type: 'uncommon',   chance: 25,  filename: 'uncommon.json', label: "Peu Com.", weight: 2 },
        { type: 'rare',       chance: 14,  filename: 'rare.json', label: "Rare", weight: 3 },
        { type: 'ultra_rare', chance: 5,   filename: 'ultra_rare.json', label: "Ultra Rare", weight: 4 },
        { type: 'secret',     chance: 1,   filename: 'secret.json', label: "SECRÈTE", weight: 5 }
    ],
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

// --- VARIABLES GLOBALES (C'est ici qu'il manquait currentGenData !) ---
let userCardsCache = []; 
let currentGenData = []; // <--- CELLE-CI ÉTAIT MANQUANTE
let cooldownInterval = null;
let currentUserRole = 'player'; 

// --- INITIALISATION ---
window.onload = () => {
    const select = document.getElementById('gen-select');
    if(select) {
        [...GEN_LIST].reverse().forEach(gen => {
            const opt = document.createElement('option');
            opt.value = gen.id;
            opt.innerText = gen.name;
            select.appendChild(opt);
        });
    }
};

// GESTION POPUP
window.showPopup = (title, msg) => {
    const el = document.getElementById('custom-popup-overlay');
    if(el) {
        document.getElementById('popup-title').innerText = title;
        document.getElementById('popup-msg').innerText = msg;
        el.style.display = 'flex';
    } else {
        alert(title + ": " + msg);
    }
};
window.closePopup = () => { document.getElementById('custom-popup-overlay').style.display = 'none'; };

// AUTH
onAuthStateChanged(auth, async (user) => {
    const loader = document.getElementById('global-loader');
    if (user) {
        document.getElementById('auth-overlay').style.display = 'none';
        document.getElementById('game-app').style.display = 'block';
        document.getElementById('user-display').innerText = user.email.split('@')[0];
        
        // Check Role via BDD
        const snap = await getDoc(doc(db, "players", user.uid));
        if(snap.exists()) {
             currentUserRole = snap.data().role || 'player';
        }

        const isAdmin = (currentUserRole === 'admin');
        const link = document.getElementById('admin-link-container');
        if(link) link.style.display = isAdmin ? 'block' : 'none';

        checkNotificationStatus();
        await fetchUserCollection(user.uid);
        await changeGen(); 

        if (!isAdmin) await checkCooldown(user.uid);
        else enableBoosterButton(true);

        if(loader) loader.style.display = 'none';
    } else {
        document.getElementById('game-app').style.display = 'none';
        document.getElementById('auth-overlay').style.display = 'flex';
        if(loader) loader.style.display = 'none';
    }
});

async function fetchUserCollection(uid) {
    const snap = await getDoc(doc(db, "players", uid));
    if (snap.exists()) {
        userCollection = snap.data().collection || [];
        updateCount();
    }
}

// CHANGEMENT GEN
window.changeGen = async () => {
    const gen = document.getElementById('gen-select').value;
    const grid = document.getElementById('cards-grid');
    grid.innerHTML = '<div style="color:white; text-align:center; width:100%;">Chargement du classeur...</div>';

    currentGenData = []; // MAINTENANT ÇA MARCHE CAR DÉCLARÉ EN HAUT
    
    for (const rate of GAME_CONFIG.dropRates) {
        try {
            const res = await fetch(`data/${gen}/${rate.filename}`);
            if(res.ok) {
                const list = await res.json();
                list.forEach(c => c.rarityKey = rate.type);
                currentGenData.push(...list);
            }
        } catch(e) {}
    }
    currentGenData.sort((a,b) => a.id - b.id);
    renderBinder();
};

function renderBinder() {
    const grid = document.getElementById('cards-grid');
    grid.innerHTML = '';
    const searchTerm = document.getElementById('search-input').value.toLowerCase();

    currentGenData.forEach(cardRef => {
        if(searchTerm && !cardRef.name.toLowerCase().includes(searchTerm)) return;
        const ownedCopies = userCollection.filter(c => c.id === cardRef.id).length;
        
        if (ownedCopies > 0) {
            const userCard = userCollection.find(c => c.id === cardRef.id);
            // On s'assure de l'objet pour l'affichage
            const cardToRender = { ...userCard, rarityKey: cardRef.rarityKey };
            const el = createCardElement(cardToRender);
            if(ownedCopies > 1) {
                const badge = document.createElement('div');
                badge.className = 'card-quantity';
                badge.innerText = `x${ownedCopies}`;
                el.appendChild(badge);
            }
            grid.appendChild(el);
        } else {
            if (cardRef.rarityKey === 'secret') return;
            const el = document.createElement('div');
            el.className = 'card-placeholder';
            el.innerHTML = `<div class="placeholder-id">#${cardRef.id}</div><div class="placeholder-text">???</div>`;
            grid.appendChild(el);
        }
    });
}

window.filterBinder = () => { renderBinder(); };

function createCardElement(card) {
    const div = document.createElement('div');
    const mainType = card.types[0];
    const cssRarity = card.rarityKey ? card.rarityKey.replace('_', '-') : 'commune';
    const labels = {'common':'COMMUNE', 'uncommon':'PEU COM.', 'rare':'RARE', 'ultra_rare':'ULTRA RARE', 'secret':'SECRET'};
    const label = labels[card.rarityKey] || '';
    const icon = GAME_CONFIG.icons[mainType] || GAME_CONFIG.icons['Normal'];
    const weak = GAME_CONFIG.icons[card.weakness] || GAME_CONFIG.icons['Normal'];

    div.className = `tcg-card ${cssRarity} bg-${mainType}`;

    let attacks = '';
    if(card.attacks) card.attacks.forEach(a => {
        attacks += `<div class="move-row"><div class="cost-icons">${Array(a.cost).fill(`<img src="${icon}" class="type-icon small">`).join('')}</div><div class="move-info"><div class="move-name">${a.name}</div></div><div class="move-dmg">${a.damage}</div></div>`;
    });

    div.innerHTML = `
        ${label !== 'COMMUNE' ? `<div class="rarity-badge badge-${cssRarity}">${label}</div>` : ''}
        <div class="card-header"><span class="card-name">${card.name}</span><div class="hp-group">${card.hp} PV <img src="${icon}" class="type-icon big"></div></div>
        <div class="img-frame"><img src="${card.image}" class="card-img" loading="lazy"></div>
        <div class="card-body">${attacks}</div>
        <div class="card-footer"><div class="stat-box">Faiblesse<br><img src="${weak}" class="type-icon small"></div><div class="stat-box">Résist.<br>-</div><div class="stat-box">Retraite<br>⚪</div></div>
    `;
    return div;
}

// OUVERTURE BOOSTER
let tempBoosterCards = [];
window.drawCard = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const isAdmin = (currentUserRole === 'admin');
    if (!isAdmin && document.getElementById('btn-draw').disabled) return;

    const gen = document.getElementById('gen-select').value;
    const btn = document.getElementById('btn-draw');
    btn.disabled = true; btn.innerText = "Génération...";

    try {
        tempBoosterCards = [];
        const packSize = Math.random() < 0.5 ? 5 : 6;

        for(let i=0; i<packSize; i++) {
            const rand = Math.random() * 100;
            let rarityConfig = GAME_CONFIG.dropRates[0];
            let acc = 0;
            for (const r of GAME_CONFIG.dropRates) {
                acc += r.chance;
                if (rand <= acc) { rarityConfig = r; break; }
            }

            const res = await fetch(`data/${gen}/${rarityConfig.filename}`);
            if(!res.ok) continue;
            const list = await res.json();
            if(!list || list.length === 0) continue;

            const card = list[Math.floor(Math.random() * list.length)];
            card.acquiredAt = Date.now();
            card.rarityKey = rarityConfig.type;
            card.generation = gen;
            tempBoosterCards.push(card);
        }

        openBoosterVisual();

        const updateData = { collection: arrayUnion(...tempBoosterCards) };
        if (!isAdmin) updateData.lastDrawTime = Date.now();
        await updateDoc(doc(db, "players", user.uid), updateData);

        userCollection.push(...tempBoosterCards);
        updateCount();
        
        if (!isAdmin) startTimer(COOLDOWN_MINUTES * 60 * 1000);
        else { btn.disabled = false; btn.innerText = "OUVRIR UN BOOSTER"; }

    } catch (e) {
        alert("Erreur: " + e.message);
        btn.disabled = false;
    }
};

function openBoosterVisual() {
    const overlay = document.getElementById('booster-overlay');
    const container = document.getElementById('booster-cards-container');
    const btn = document.getElementById('close-booster-btn');
    container.innerHTML = '';
    btn.style.display = 'none';
    overlay.style.display = 'flex';

    let cardsRevealed = 0;
    tempBoosterCards.forEach((card) => {
        const flipCard = document.createElement('div');
        flipCard.className = 'flip-card';
        const inner = document.createElement('div');
        inner.className = 'flip-card-inner';
        const front = document.createElement('div');
        front.className = 'flip-card-front';
        const back = document.createElement('div');
        back.className = 'flip-card-back';
        back.appendChild(createCardElement(card));
        inner.appendChild(front);
        inner.appendChild(back);
        flipCard.appendChild(inner);

        flipCard.onclick = () => {
            if(!flipCard.classList.contains('flipped')) {
                flipCard.classList.add('flipped');
                cardsRevealed++;
                if(cardsRevealed === tempBoosterCards.length) btn.style.display = 'block';
            }
        };
        container.appendChild(flipCard);
    });
}

window.closeBooster = () => {
    document.getElementById('booster-overlay').style.display = 'none';
    renderBinder();
};

window.googleLogin = async () => authUser(signInWithPopup(auth, provider));
window.signUp = async () => { authUser(createUserWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value)); };
window.signIn = async () => { try { await signInWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value); } catch(e) { window.showPopup("Erreur", e.message); } };
window.logout = () => signOut(auth);

async function authUser(promise) { 
    try { 
        const res = await promise; 
        const ref = doc(db, "players", res.user.uid); 
        const snap = await getDoc(ref); 
        if (!snap.exists()) await setDoc(ref, { email: res.user.email, collection: [], lastDrawTime: 0, role: 'player' }); 
    } catch (e) { console.error(e); } 
}

async function checkCooldown(uid) {
    const snap = await getDoc(doc(db, "players", uid));
    if (snap.exists()) {
        const lastDraw = snap.data().lastDrawTime || 0;
        const diff = Date.now() - lastDraw;
        const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;
        if (diff < cooldownMs) startTimer(cooldownMs - diff);
        else enableBoosterButton(true);
    } else enableBoosterButton(true);
}

function startTimer(durationMs) {
    const btn = document.getElementById('btn-draw');
    const display = document.getElementById('cooldown-display');
    const val = document.getElementById('timer-val');
    btn.disabled = true; btn.classList.add('disabled'); btn.innerHTML = `<div class="booster-content">RECHARGEMENT...</div>`; display.style.display = 'block';
    let remaining = durationMs;
    if (cooldownInterval) clearInterval(cooldownInterval);
    const tick = () => {
        remaining -= 1000;
        if (remaining <= 0) { clearInterval(cooldownInterval); enableBoosterButton(true); return; }
        const m = Math.floor((remaining / 1000 / 60) % 60); const s = Math.floor((remaining / 1000) % 60);
        val.innerText = `${m}:${s < 10 ? '0'+s : s}`;
    };
    tick(); cooldownInterval = setInterval(tick, 1000);
}

function enableBoosterButton(enabled) {
    const btn = document.getElementById('btn-draw'); const display = document.getElementById('cooldown-display');
    if (enabled) { btn.disabled = false; btn.classList.remove('disabled'); btn.innerHTML = '<div class="booster-content">OUVRIR UN BOOSTER</div>'; display.style.display = 'none'; if (cooldownInterval) clearInterval(cooldownInterval); }
}

function updateCount() {
    const el = document.getElementById('card-count');
    if(el) el.innerText = userCollection.length;
}

window.updateSort = () => {
    // Cette fonction n'est plus utilisée dans le mode Binder pur, mais gardée pour compatibilité
    renderBinder();
};

window.requestNotification = async () => { if (!("Notification" in window)) return; const permission = await Notification.requestPermission(); if (permission === "granted") document.getElementById('notif-bell').classList.add('bell-active'); };
function checkNotificationStatus() { if (Notification.permission === "granted") document.getElementById('notif-bell').classList.add('bell-active'); else if (Notification.permission === "default" && !localStorage.getItem('notifAsked')) { window.requestNotification(); localStorage.setItem('notifAsked', 'true'); } }