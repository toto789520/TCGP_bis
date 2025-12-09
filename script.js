import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, setDoc, updateDoc, arrayUnion, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// --- CONFIGURATION ---
const ADMIN_EMAIL = "bryan.drouet24@gmail.com"; // TON EMAIL ICI

const GAME_CONFIG = {
    dropRates: [
        { type: 'common',     chance: 50,  filename: 'common.json', label: "Commune" },
        { type: 'uncommon',   chance: 30,  filename: 'uncommon.json', label: "Peu Commune" },
        { type: 'rare',       chance: 15,  filename: 'rare.json', label: "Rare" },
        { type: 'ultra_rare', chance: 4.5, filename: 'ultra_rare.json', label: "Ultra Rare" },
        { type: 'secret',     chance: 0.5, filename: 'secret.json', label: "Secrète" }
    ],
    icons: {
        // Icônes SVG encodées en Base64 pour éviter le blocage CORB
        Fire: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAyMCI+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iMTAiIGZpbGw9IiNGMDgwMzAiLz48cGF0aCBkPSZNMy41IDEwLjVjMS41IDMgMyAzIDMuNSAzIC41IDAgMS41LTIuNSAzLTQ1IDEuNS0xLjUgMy0uNSAzIC41czEuNSAzIDMuNSAzIiBzdHJva2U9IiNGRkQiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0ibm9uZSIvPjwvc3ZnPg==',
        Water: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAyMCI+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iMTAiIGZpbGw9Iiw2ODkwRjAiLz48cGF0aCBkPSJNMTAgMy41Yy0yIDQtNCA2LTQgOaAwIDAgNiAwIDRzMi01IDQtOS00LTQtNC00IiBmaWxsPSIjRkZGIi8+PC9zdmc+',
        Grass: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAyMCI+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iMTAiIGZpbGw9IiM3OEM4NTAiLz48cGF0aCBkPSJNNSAxNWw1LTEwIDUgMTAtMi0zLTMgMi0zLTJ6IiBmaWxsPSIjRkZGIi8+PC9zdmc+',
        Electric: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAyMCI+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iMTAiIGZpbGw9IiNGOEQwMzAiLz48cGF0aCBkPSJNMTEgMi41bC01IDdoNGwtMyA4IDgtOWgtNHoiIGZpbGw9IiMzMzMiLz48L3N2Zz4=',
        Psychic: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAyMCI+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iMTAiIGZpbGw9IiNGODU4ODgiLz48cGF0aCBkPSJNMTAgNWMtMiAwLTQgMi00IDRzMiA0IDQgNHM0LTIgNC00cy0yLTQtNC00IiBzdHJva2U9IiNGRkYiIHN0cm9rZS13aWR0aD0iMiIgZmlsbD0ibm9uZSIvPjwvc3ZnPg==',
        Fighting: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAyMCI+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iMTAiIGZpbGw9IiNDMDMwMjgiLz48cGF0aCBkPSJNMzUgNy41aDEzbS02LjUtNi41djEzIiBzdHJva2U9IiNGRkYiIHN0cm9rZS13aWR0aD0iMyIvPjwvc3ZnPg==',
        Darkness: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAyMCI+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iMTAiIGZpbGw9IiM3MDU3NDYiLz48cGF0aCBkPSJNMTAgNWE1IDUgMCAxIDAgMCAxMCA1IDUgMCAwIDAgMC0xMCIgZmlsbD0iI0ZGRiIvPjwvc3ZnPg==',
        Metal: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAyMCI+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iMTAiIGZpbGw9IiNCOEI4RDAiLz48cmVjdCB4PSI3IiB5PSI1IiB3aWR0aD0iNiIgaGVpZ2h0PSIxMCIgZmlsbD0iI0ZGRiIvPjwvc3ZnPg==',
        Fairy: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAyMCI+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iMTAiIGZpbGw9IiNFRTk5QUMiLz48cGF0aCBkPSJNMTAgNGwyIDZoNmwtNSA0IDIgNmwtNS00LTUtNGw2LTZsNS00IiBmaWxsPSIjRkZGIi8+PC9zdmc+',
        Dragon: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAyMCI+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iMTAiIGZpbGw9IiM2RjM1RkMiLz48cGF0aCBkPSJNNSA1bDQtMiA2IDggMy00LTItMiA0IDJ2MTBsLTQtMnYtNGwtNi04IiBmaWxsPSIjRkZGIi8+PC9zdmc+',
        Normal: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAyMCI+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iMTAiIGZpbGw9IiNBOEE4NzgiLz48Y2lyY2xlIGN4PSIxMCIgY3k9IjEwIiByPSI0IiBmaWxsPSIjRkZGIi8+PC9zdmc+',
        // Fallback générique pour les autres types (Ice, Ground, etc.)
        Colorless: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyMCAyMCI+PGNpcmNsZSBjeD0iMTAiIGN5PSIxMCIgcj0iMTAiIGZpbGw9IiNBOEE4NzgiLz48Y2lyY2xlIGN4PSIxMCIgY3k9IjEwIiByPSI0IiBmaWxsPSIjRkZGIi8+PC9zdmc+'
    }
};

// ⚠️ COLLE TA CONFIG FIREBASE ICI ⚠️
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

// --- AUTHENTIFICATION ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        document.getElementById('auth-overlay').style.display = 'none';
        document.getElementById('game-app').style.display = 'block';
        document.getElementById('user-display').innerText = user.displayName || user.email.split('@')[0];
        
        // 🔒 PROTECTION ADMIN VISUELLE
        const adminPanel = document.getElementById('admin-panel');
        if (user.email === ADMIN_EMAIL) {
            adminPanel.style.display = 'block';
        } else {
            adminPanel.style.display = 'none';
        }

        loadCollection(user.uid);
    } else {
        document.getElementById('auth-overlay').style.display = 'flex';
        document.getElementById('game-app').style.display = 'none';
    }
});

window.googleLogin = async () => authUser(signInWithPopup(auth, provider));
window.signUp = async () => {
    const e = document.getElementById('email').value;
    const p = document.getElementById('password').value;
    authUser(createUserWithEmailAndPassword(auth, e, p));
};
window.signIn = async () => {
    try {
        await signInWithEmailAndPassword(auth, document.getElementById('email').value, document.getElementById('password').value);
    } catch(e) { document.getElementById('auth-msg').innerText = "Erreur: " + e.message; }
};
window.logout = () => signOut(auth);

async function authUser(promise) {
    try {
        const res = await promise;
        const ref = doc(db, "players", res.user.uid);
        const snap = await getDoc(ref);
        if (!snap.exists()) await setDoc(ref, { email: res.user.email, collection: [] });
    } catch (e) { console.error(e); }
}

// --- GAMEPLAY ---
window.drawCard = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const btn = document.getElementById('btn-draw');
    const genSelect = document.getElementById('gen-select');
    const selectedGen = genSelect.value; 

    btn.disabled = true; 
    btn.innerHTML = `Ouverture ${selectedGen.toUpperCase()}...`;

    try {
        // 1. Choix Rareté
        const rand = Math.random() * 100;
        let rarityConfig = GAME_CONFIG.dropRates[0];
        let acc = 0;
        for (const r of GAME_CONFIG.dropRates) {
            acc += r.chance;
            if (rand <= acc) { rarityConfig = r; break; }
        }

        // 2. Chargement du fichier JSON
        const filePath = `data/${selectedGen}/${rarityConfig.filename}`;
        
        let response;
        try {
            response = await fetch(filePath);
        } catch (e) {
            throw new Error(`Impossible de trouver le fichier : ${filePath}`);
        }

        if (!response.ok) throw new Error(`Erreur chargement fichier (404): ${filePath}`);
        
        const cardList = await response.json();

        // --- SECURITE : Vérifier que la liste n'est pas vide ---
        if (!cardList || cardList.length === 0) {
            console.warn(`Le fichier ${filePath} est vide. Tentative avec les communes...`);
            // Fallback : Si pas de carte rare/secrète dans cette gen, on force une commune
            const fallbackPath = `data/${selectedGen}/common.json`;
            const fbRes = await fetch(fallbackPath);
            const fbList = await fbRes.json();
            if(!fbList || fbList.length === 0) throw new Error("Aucune carte trouvée dans cette génération !");
            
            // On pioche dans les communes à la place
            const fallbackCard = fbList[Math.floor(Math.random() * fbList.length)];
            finalizeDraw(user, fallbackCard, 'common', selectedGen);
            return;
        }

        // 3. Piocher
        const card = cardList[Math.floor(Math.random() * cardList.length)];
        
        // --- SECURITE : Vérifier que la carte existe bien ---
        if (!card) {
            throw new Error("Erreur interne : Carte indéfinie lors du tirage.");
        }

        // 4. Finaliser
        finalizeDraw(user, card, rarityConfig.type, selectedGen);

    } catch (error) {
        console.error(error);
        alert("Erreur : " + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<div class="booster-content">OUVRIR UN BOOSTER</div>';
    }
};

// Nouvelle fonction utilitaire pour éviter la répétition de code
async function finalizeDraw(user, card, rarityKey, generation) {
    // Enrichir l'objet carte
    card.acquiredAt = Date.now();
    card.rarityKey = rarityKey; 
    card.generation = generation; 

    // Sauvegarde Firebase
    await updateDoc(doc(db, "players", user.uid), { collection: arrayUnion(card) });

    // Affichage
    renderCard(card, true);
    updateCount(1);
}

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

// --- AFFICHAGE ---
function renderCard(card, animate = false) {
    const grid = document.getElementById('cards-grid');
    const div = document.createElement('div');
    
    const mainType = card.types[0];
    const cssRarity = card.rarityKey ? card.rarityKey.replace('_', '-') : 'commune';
    const typeIconUrl = GAME_CONFIG.icons[mainType] || GAME_CONFIG.icons['Normal'];
    const weakIconUrl = GAME_CONFIG.icons[card.weakness] || GAME_CONFIG.icons['Normal'];
    
    div.className = `tcg-card ${cssRarity} bg-${mainType}`;
    if (animate) div.style.animation = "popIn 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)";

    let attacksHtml = '';
    if(card.attacks && card.attacks.length > 0) {
        card.attacks.forEach(atk => {
            const costHtml = Array(atk.cost).fill(`<img src="${typeIconUrl}" class="type-icon small">`).join('');
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

    // Gestion image + Log erreur console
    const img = document.createElement('img');
    img.src = card.image;
    img.className = 'card-img';
    img.loading = 'lazy';
    img.alt = card.name;
    img.onerror = () => {
        console.error(`❌ Image cassée: ${card.name} (ID: ${card.id})`);
        console.log(`🔗 URL: ${card.image}`);
    };

    div.innerHTML = `
        <div class="card-header">
            <span class="card-name">${card.name}</span>
            <div class="hp-group">${card.hp} PV <img src="${typeIconUrl}" class="type-icon big"></div>
        </div>
        <div class="img-frame"></div>
        <div class="card-body">${attacksHtml}</div>
        <div class="card-footer">
            <div class="stat-box">Faiblesse<br>${card.weakness !== "Standard" ? `<img src="${weakIconUrl}" class="type-icon small">` : "-"}</div>
            <div class="stat-box">Résist.<br>-</div>
            <div class="stat-box">Retraite<br>⚪</div>
        </div>
    `;
    
    div.querySelector('.img-frame').appendChild(img);
    grid.prepend(div);
}