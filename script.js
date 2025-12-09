import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, updateDoc, arrayUnion, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const ADMIN_EMAIL = "bryan.drouet24@gmail.com"; 
const BOOSTER_SIZE = 5; 
const COOLDOWN_MINUTES = 5; 

// --- CONFIG FIREBASE ---
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

// (GAME_CONFIG reste inchangé avec tes icônes locales...)
const GAME_CONFIG = {
    dropRates: [
        { type: 'common',     chance: 55,  filename: 'common.json', label: "Commune", weight: 1 },
        { type: 'uncommon',   chance: 25,  filename: 'uncommon.json', label: "Peu Com.", weight: 2 },
        { type: 'rare',       chance: 14,  filename: 'rare.json', label: "Rare", weight: 3 },
        { type: 'ultra_rare', chance: 5,   filename: 'ultra_rare.json', label: "Ultra Rare", weight: 4 },
        { type: 'secret',     chance: 1,   filename: 'secret.json', label: "SECRÈTE", weight: 5 }
    ],
    icons: {
        Fire: 'icons/Pokémon_Fire_Type_Icon.svg',
        Water: 'icons/Pokémon_Water_Type_Icon.svg',
        Grass: 'icons/Pokémon_Grass_Type_Icon.svg',
        Electric: 'icons/Pokémon_Electric_Type_Icon.svg',
        Psychic: 'icons/Pokémon_Psychic_Type_Icon.svg',
        Fighting: 'icons/Pokémon_Fighting_Type_Icon.svg',
        Darkness: 'icons/Pokémon_Dark_Type_Icon.svg', 
        Metal: 'icons/Pokémon_Steel_Type_Icon.svg',
        Fairy: 'icons/Pokémon_Fairy_Type_Icon.svg',
        Dragon: 'icons/Pokémon_Dragon_Type_Icon.svg',
        Ice: 'icons/Pokémon_Ice_Type_Icon.svg',
        Ground: 'icons/Pokémon_Ground_Type_Icon.svg',
        Flying: 'icons/Pokémon_Flying_Type_Icon.svg',
        Bug: 'icons/Pokémon_Bug_Type_Icon.svg',
        Rock: 'icons/Pokémon_Rock_Type_Icon.svg',
        Ghost: 'icons/Pokémon_Ghost_Type_Icon.svg',
        Poison: 'icons/Pokémon_Poison_Type_Icon.svg',
        Normal: 'icons/Pokémon_Normal_Type_Icon.svg',
        Colorless: 'icons/Pokémon_Normal_Type_Icon.svg'
    }
};

let userCardsCache = []; 
let cooldownInterval = null;

// --- GESTION POPUP (Remplace Alert) ---
window.showPopup = (title, msg) => {
    document.getElementById('popup-title').innerText = title;
    document.getElementById('popup-msg').innerText = msg;
    document.getElementById('custom-popup-overlay').style.display = 'flex';
};
window.closePopup = () => {
    document.getElementById('custom-popup-overlay').style.display = 'none';
};

// --- AUTHENTIFICATION ---
onAuthStateChanged(auth, async (user) => {
    const loader = document.getElementById('global-loader');
    
    if (user) {
        document.getElementById('auth-overlay').style.display = 'none';
        document.getElementById('game-app').style.display = 'block';
        document.getElementById('user-display').innerText = user.email.split('@')[0];
        
        // ADMIN LINK
        const isAdmin = (user.email === ADMIN_EMAIL);
        document.getElementById('admin-link-container').style.display = isAdmin ? 'block' : 'none';

        // Check Notifications permission on first load
        checkNotificationStatus();

        await loadCollection(user.uid);
        if (!isAdmin) await checkCooldown(user.uid);
        else enableBoosterButton(true);

        loader.style.display = 'none';
    } else {
        document.getElementById('game-app').style.display = 'none';
        document.getElementById('auth-overlay').style.display = 'flex';
        if(cooldownInterval) clearInterval(cooldownInterval);
        loader.style.display = 'none';
    }
});

// --- NOTIFICATIONS SYSTEM ---
window.requestNotification = async () => {
    if (!("Notification" in window)) {
        window.showPopup("Erreur", "Votre navigateur ne supporte pas les notifications.");
        return;
    }
    
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
        window.showPopup("Succès", "Notifications activées ! Vous serez averti quand un booster sera prêt.");
        document.getElementById('notif-bell').classList.add('bell-active');
        new Notification("Poké-TCG", { body: "Les notifications fonctionnent !", icon: "icons/Pokémon_Normal_Type_Icon.svg" });
    } else {
        window.showPopup("Refusé", "Vous avez bloqué les notifications.");
        document.getElementById('notif-bell').classList.remove('bell-active');
    }
};

function checkNotificationStatus() {
    if (Notification.permission === "granted") {
        document.getElementById('notif-bell').classList.add('bell-active');
    } else if (Notification.permission === "default") {
        // Demande automatique à la première connexion si pas encore décidé
        if (!localStorage.getItem('notifAsked')) {
            window.requestNotification();
            localStorage.setItem('notifAsked', 'true');
        }
    }
}

function sendReadyNotification() {
    if (Notification.permission === "granted") {
        new Notification("Booster Prêt ! 🎁", {
            body: "Votre délai d'attente est terminé. Venez ouvrir vos cartes !",
            icon: "icons/Pokémon_Fire_Type_Icon.svg"
        });
    }
}

// (Auth Functions: googleLogin, etc...)
window.googleLogin = async () => authUser(signInWithPopup(auth, provider));
window.signUp = async () => { const e = document.getElementById('email').value; const p = document.getElementById('password').value; authUser(createUserWithEmailAndPassword(auth, e, p)); };
window.signIn = async () => { try { await signInWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value); } catch(e) { window.showPopup("Erreur", e.message); } };
window.logout = () => signOut(auth);
async function authUser(promise) { try { const res = await promise; const ref = doc(db, "players", res.user.uid); const snap = await getDoc(ref); if (!snap.exists()) await setDoc(ref, { email: res.user.email, collection: [], lastDrawTime: 0 }); } catch (e) { console.error(e); } }

// --- COOLDOWN ---
async function checkCooldown(uid) {
    const snap = await getDoc(doc(db, "players", uid));
    if (snap.exists()) {
        const lastDraw = snap.data().lastDrawTime || 0;
        const now = Date.now();
        const diff = now - lastDraw;
        const cooldownMs = COOLDOWN_MINUTES * 60 * 1000;

        if (diff < cooldownMs) {
            startTimer(cooldownMs - diff);
        } else {
            enableBoosterButton(true);
        }
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
            sendReadyNotification(); // Envoi la notif !
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

// --- DRAW ---
window.drawCard = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const isAdmin = (user.email === ADMIN_EMAIL);
    const genSelect = document.getElementById('gen-select');
    const selectedGen = genSelect.value;
    const btn = document.getElementById('btn-draw');

    if (!isAdmin && btn.disabled) return;

    btn.disabled = true;
    btn.innerHTML = "Ouverture...";

    try {
        const newCards = [];
        const packSize = Math.random() < 0.5 ? 5 : 6;

        for(let i=0; i<packSize; i++) {
            const rand = Math.random() * 100;
            let rarityConfig = GAME_CONFIG.dropRates[0];
            let acc = 0;
            for (const r of GAME_CONFIG.dropRates) {
                acc += r.chance;
                if (rand <= acc) { rarityConfig = r; break; }
            }

            const response = await fetch(`data/${selectedGen}/${rarityConfig.filename}`);
            if (!response.ok) {
                var list = await (await fetch(`data/${selectedGen}/common.json`)).json();
                rarityConfig = GAME_CONFIG.dropRates[0];
            } else {
                var list = await response.json();
            }

            if(!list || list.length === 0) continue; 

            const card = list[Math.floor(Math.random() * list.length)];
            card.acquiredAt = Date.now();
            card.rarityKey = rarityConfig.type;
            card.rarityWeight = rarityConfig.weight;
            card.generation = selectedGen;
            
            newCards.push(card);
        }

        const updateData = { collection: arrayUnion(...newCards) };
        if (!isAdmin) updateData.lastDrawTime = Date.now();

        await updateDoc(doc(db, "players", user.uid), updateData);

        newCards.forEach(c => { userCardsCache.push(c); renderCard(c, true); });
        updateCount(newCards.length);

        if (!isAdmin) startTimer(COOLDOWN_MINUTES * 60 * 1000);
        else { btn.disabled = false; btn.innerHTML = '<div class="booster-content">OUVRIR UN BOOSTER</div>'; }

    } catch (error) {
        window.showPopup("Erreur", error.message);
        btn.disabled = false;
    }
};

// ... (Fonctions loadCollection, updateSort, renderCard : copie-les du code précédent, elles ne changent pas sauf alert() remplacé par window.showPopup())
async function loadCollection(uid) {
    const snap = await getDoc(doc(db, "players", uid));
    if (snap.exists()) {
        userCardsCache = snap.data().collection || [];
        document.getElementById('card-count').innerText = userCardsCache.length;
        window.updateSort();
    }
}

window.updateSort = () => {
    const sortType = document.getElementById('sort-select').value;
    const searchText = document.getElementById('search-input').value.toLowerCase().trim();
    const grid = document.getElementById('cards-grid');
    grid.innerHTML = '';

    let filtered = userCardsCache.filter(c => c.name.toLowerCase().includes(searchText));

    filtered.sort((a, b) => {
        switch(sortType) {
            case 'date-desc': return b.acquiredAt - a.acquiredAt;
            case 'rarity-desc': 
                if ((b.rarityWeight||0) !== (a.rarityWeight||0)) return (b.rarityWeight||0) - (a.rarityWeight||0);
                return a.name.localeCompare(b.name);
            case 'hp-desc': return (b.hp||0) - (a.hp||0);
            case 'name-asc': return a.name.localeCompare(b.name);
            case 'gen-asc': 
                if (a.generation !== b.generation) return a.generation.localeCompare(b.generation);
                return (b.rarityWeight||0) - (a.rarityWeight||0);
            default: return 0;
        }
    });

    if(filtered.length === 0) grid.innerHTML = '<div style="text-align:center; padding:20px; opacity:0.5;">Aucune carte trouvée</div>';
    filtered.forEach(c => renderCard(c, false));
    document.getElementById('card-count').innerText = filtered.length;
};

function renderCard(card, animate = false) {
    const grid = document.getElementById('cards-grid');
    const div = document.createElement('div');
    const mainType = card.types[0];
    const cssRarity = card.rarityKey ? card.rarityKey.replace('_', '-') : 'commune';
    const labels = {'common':'COMMUNE', 'uncommon':'PEU COM.', 'rare':'RARE', 'ultra_rare':'ULTRA RARE', 'secret':'SECRET'};
    const label = labels[card.rarityKey] || '';
    const icon = GAME_CONFIG.icons[mainType] || GAME_CONFIG.icons['Normal'];
    const weak = GAME_CONFIG.icons[card.weakness] || GAME_CONFIG.icons['Normal'];

    div.className = `tcg-card ${cssRarity} bg-${mainType}`;
    if (animate) div.style.animation = "popIn 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)";

    let attacks = '';
    if(card.attacks) card.attacks.forEach(a => {
        attacks += `<div class="move-row"><div class="cost-icons">${Array(a.cost).fill(`<img src="${icon}" class="type-icon small">`).join('')}</div><div class="move-info"><div class="move-name">${a.name}</div></div><div class="move-dmg">${a.damage}</div></div>`;
    });

    const img = document.createElement('img');
    img.src = card.image;
    img.className = 'card-img';
    img.loading = 'lazy';
    
    div.innerHTML = `
        ${label !== 'COMMUNE' ? `<div class="rarity-badge badge-${cssRarity}">${label}</div>` : ''}
        <div class="card-header"><span class="card-name">${card.name}</span><div class="hp-group">${card.hp} PV <img src="${icon}" class="type-icon big"></div></div>
        <div class="img-frame"></div>
        <div class="card-body">${attacks}</div>
        <div class="card-footer"><div class="stat-box">Faiblesse<br><img src="${weak}" class="type-icon small"></div><div class="stat-box">Résist.<br>-</div><div class="stat-box">Retraite<br>⚪</div></div>
    `;
    div.querySelector('.img-frame').appendChild(img);
    if(animate) grid.prepend(div); else grid.appendChild(div);
}