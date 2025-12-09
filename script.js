import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, updateDoc, arrayUnion, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- 1. CONFIGURATION DU JEU ---
const GAME_CONFIG = {
    // Taux de drop
    dropRates: [
        { type: 'common',     chance: 50,  file: 'data/common.json' },
        { type: 'uncommon',   chance: 30,  file: 'data/uncommon.json' },
        { type: 'rare',       chance: 15,  file: 'data/rare.json' },
        { type: 'ultra_rare', chance: 4.5, file: 'data/ultra_rare.json' },
        { type: 'secret',     chance: 0.5, file: 'data/secret.json' }
    ],
    // Dictionnaire des Images SVG pour les types (Pas d'emojis)
    icons: {
        Fire: 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Pok%C3%A9mon_Fire_Type_Icon.svg',
        Water: 'https://upload.wikimedia.org/wikipedia/commons/0/0b/Pok%C3%A9mon_Water_Type_Icon.svg',
        Grass: 'https://upload.wikimedia.org/wikipedia/commons/f/f6/Pok%C3%A9mon_Grass_Type_Icon.svg',
        Electric: 'https://upload.wikimedia.org/wikipedia/commons/a/a9/Pok%C3%A9mon_Electric_Type_Icon.svg',
        Psychic: 'https://upload.wikimedia.org/wikipedia/commons/a/ab/Pok%C3%A9mon_Psychic_Type_Icon.svg',
        Fighting: 'https://upload.wikimedia.org/wikipedia/commons/b/b7/Pok%C3%A9mon_Fighting_Type_Icon.svg',
        Darkness: 'https://upload.wikimedia.org/wikipedia/commons/0/09/Pok%C3%A9mon_Dark_Type_Icon.svg',
        Metal: 'https://upload.wikimedia.org/wikipedia/commons/3/38/Pok%C3%A9mon_Steel_Type_Icon.svg',
        Fairy: 'https://upload.wikimedia.org/wikipedia/commons/0/08/Pok%C3%A9mon_Fairy_Type_Icon.svg',
        Dragon: 'https://upload.wikimedia.org/wikipedia/commons/a/a6/Pok%C3%A9mon_Dragon_Type_Icon.svg',
        Normal: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/Pok%C3%A9mon_Normal_Type_Icon.svg',
        // Fallback
        Colorless: 'https://upload.wikimedia.org/wikipedia/commons/a/aa/Pok%C3%A9mon_Normal_Type_Icon.svg'
    }
};

// --- 2. CONFIG FIREBASE (REMPLACE PAR TA CONFIG) ---
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

// --- 3. GESTION AUTH ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('auth-overlay').style.display = 'none';
        document.getElementById('game-app').style.display = 'block';
        document.getElementById('user-display').innerText = user.displayName || user.email.split('@')[0];
        loadCollection(user.uid);
    } else {
        document.getElementById('auth-overlay').style.display = 'flex';
        document.getElementById('game-app').style.display = 'none';
    }
});

window.googleLogin = async () => authAndCreateUser(signInWithPopup(auth, provider));
window.signUp = async () => {
    const e = document.getElementById('email').value;
    const p = document.getElementById('password').value;
    authAndCreateUser(createUserWithEmailAndPassword(auth, e, p));
};
window.signIn = async () => {
    try {
        await signInWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value);
    } catch(e) { document.getElementById('auth-msg').innerText = "Erreur: " + e.message; }
};
window.logout = () => signOut(auth);

async function authAndCreateUser(promise) {
    try {
        const result = await promise;
        const ref = doc(db, "players", result.user.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) await setDoc(ref, { email: result.user.email, collection: [] });
    } catch (e) { console.error(e); }
}

// --- 4. GAMEPLAY (TIRAGE) ---
window.drawCard = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const btn = document.getElementById('btn-draw');
    const originalText = btn.innerHTML;
    btn.disabled = true; 
    btn.innerHTML = "Ouverture...";

    try {
        // Tirage pondéré rareté
        const rand = Math.random() * 100;
        let selected = GAME_CONFIG.dropRates[0];
        let acc = 0;
        for (const r of GAME_CONFIG.dropRates) {
            acc += r.chance;
            if (rand <= acc) { selected = r; break; }
        }

        // Fetch JSON
        const response = await fetch(selected.file);
        if (!response.ok) throw new Error("Données introuvables. Générez les JSONs.");
        const list = await response.json();

        // Choix carte
        const card = list[Math.floor(Math.random() * list.length)];
        
        // Ajout métadonnées
        card.acquiredAt = Date.now();
        card.rarityKey = selected.type; 

        // Sauvegarde
        await updateDoc(doc(db, "players", user.uid), { collection: arrayUnion(card) });

        // Rendu
        renderCard(card, true);
        updateCount(1);

    } catch (error) {
        alert(error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
};

async function loadCollection(uid) {
    const snap = await getDoc(doc(db, "players", uid));
    if (snap.exists()) {
        const cards = snap.data().collection || [];
        document.getElementById('cards-grid').innerHTML = '';
        document.getElementById('card-count').innerText = cards.length;
        cards.sort((a,b) => b.acquiredAt - a.acquiredAt);
        cards.forEach(c => renderCard(c));
    }
}

function updateCount(n) {
    const el = document.getElementById('card-count');
    el.innerText = parseInt(el.innerText) + n;
}

// --- 5. RENDER (AFFICHAGE AVEC SVG) ---
function renderCard(card, animate = false) {
    const grid = document.getElementById('cards-grid');
    const div = document.createElement('div');
    
    // Déduction des assets
    const mainType = card.types[0];
    const cssRarity = card.rarityKey ? card.rarityKey.replace('_', '-') : 'commune';
    const typeIconUrl = GAME_CONFIG.icons[mainType] || GAME_CONFIG.icons['Normal'];
    
    div.className = `tcg-card ${cssRarity} bg-${mainType}`;
    if (animate) div.style.animation = "popIn 0.5s ease-out";

    // HTML des attaques (Boucle pour créer les images d'énergie)
    let attacksHtml = '';
    if(card.attacks) {
        card.attacks.forEach(atk => {
            // Créer X balises <img> pour le coût
            const costHtml = Array(atk.cost).fill(`<img src="${typeIconUrl}" class="type-icon">`).join('');
            attacksHtml += `
                <div class="move-row">
                    <div class="cost-icons">${costHtml}</div>
                    <div class="move-info">
                        <div class="move-name">${atk.name}</div>
                    </div>
                    <div class="move-dmg">${atk.damage}</div>
                </div>
            `;
        });
    }

    // Icônes Footer
    const weakIcon = card.weakness !== "None" ? `<img src="${GAME_CONFIG.icons['Fire']}" class="type-icon small">` : "-";
    const retreatIcon = `<img src="${GAME_CONFIG.icons['Normal']}" class="type-icon small">`;

    div.innerHTML = `
        <div class="card-header">
            <span class="card-name">${card.name}</span>
            <div class="hp-group">
                ${card.hp} <img src="${typeIconUrl}" class="type-icon big">
            </div>
        </div>
        <div class="img-frame">
            <img src="${card.image}" class="card-img" loading="lazy">
        </div>
        <div class="card-body">
            ${attacksHtml}
        </div>
        <div class="card-footer">
            <div class="stat-box">Faiblesse<br>${weakIcon}</div>
            <div class="stat-box">Résist.<br>-</div>
            <div class="stat-box">Retraite<br>${retreatIcon}</div>
        </div>
    `;

    grid.prepend(div);
}
