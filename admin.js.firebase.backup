import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, updateDoc, collection, getDocs, deleteDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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

window.showPopup = (title, msg) => {
    const titleEl = document.getElementById('popup-title');
    if (titleEl) titleEl.innerHTML = title;
    const msgEl = document.getElementById('popup-content') || document.getElementById('popup-msg');
    if (msgEl) {
        msgEl.innerHTML = String(msg).replace(/\n/g, '<br>');
        msgEl.style.textAlign = 'left';
    }
    const overlay = document.getElementById('custom-popup-overlay');
    if (overlay) overlay.style.display = 'flex';
};
window.closePopup = () => { document.getElementById('custom-popup-overlay').style.display = 'none'; };

// VÉRIFICATION VIA BDD (Plus via email)
onAuthStateChanged(auth, async (user) => {
    const loader = document.getElementById('global-loader');
    if (user) {
        const snap = await getDoc(doc(db, "players", user.uid));
        if (snap.exists() && snap.data().role === 'admin') {
            loader.style.display = 'none';
            loadAllPlayers();
        } else {
            window.location.href = "index.html"; // Pas admin -> Dehors
        }
    } else {
        window.location.href = "index.html";
    }
});

window.loadAllPlayers = async () => {
    const list = document.getElementById('players-list');
    list.innerHTML = '<tr><td colspan="5">Chargement...</td></tr>';

    try {
        const querySnapshot = await getDocs(collection(db, "players"));
        list.innerHTML = '';
        
        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const role = data.role || 'player';
            let roleColor = '#ccc';
            let roleIcon = '<img src="assets/icons/user.svg" class="title-icon" alt="user">';
            if (role === 'admin') {
                roleColor = '#ffd700';
                roleIcon = '<img src="assets/icons/crown.svg" class="title-icon" alt="admin">';
            } else if (role === 'vip') {
                roleColor = '#00e676';
                roleIcon = '<img src="assets/icons/gem.svg" class="title-icon" alt="vip">';
            }

            const tr = document.createElement('tr');
                let actions = `
                <button onclick="resetCooldown('${docSnap.id}', '${data.email}')" class="btn-action btn-cooldown"><img src="assets/icons/hourglass.svg" class="title-icon" alt="hourglass"> Reset</button>
                <button onclick="resetPlayer('${docSnap.id}', '${data.email}')" class="btn-action btn-reset"><img src="assets/icons/triangle-alert.svg" class="title-icon" alt="warn"> Deck</button>
                <button onclick="deleteAccount('${docSnap.id}', '${data.email}')" class="btn-action btn-delete"><img src="assets/icons/x.svg" class="title-icon" alt="del"> DEL</button>
            `;
            // Afficher le bouton rôle seulement si ce n'est pas un admin
            if (role !== 'admin') {
                let roleButtonEmoji = role === 'vip' ? '<img src="assets/icons/arrow-down-from-line.svg" class="title-icon" alt="down">' : '<img src="assets/icons/arrow-up-from-line.svg" class="title-icon" alt="up">';
                let roleButtonLabel = role === 'vip' ? 'Rétrograder' : 'VIP';
                actions = `<button onclick="toggleRole('${docSnap.id}', '${role}')" class="btn-action btn-role" style="background:#8e44ad">${roleButtonEmoji} ${roleButtonLabel}</button>` + actions;
            }
            tr.innerHTML = `
                <td><strong>${data.email}</strong></td>
                <td>
                    <div class="col-role role-${role}" style="color:${roleColor}; font-weight:bold;">${roleIcon} ${role.toUpperCase()}</div>
                </td>
                <td><span class="user-pill">${data.collection ? data.collection.length : 0}</span></td>
                <td>
                    <div class="col-actions">
                        ${actions}
                    </div>
                </td>`;
            list.appendChild(tr);
        });
    } catch (e) { console.error(e); window.showPopup("Erreur", "Vérifie les droits BDD"); }
};

// CHANGER LE RÔLE (ADMIN <-> PLAYER)
window.toggleRole = async (uid, currentRole) => {
    // Ne jamais changer le rôle d'un admin ici
    if (currentRole === 'admin') return;
    let newRole = 'vip';
    if (currentRole === 'vip') newRole = 'player';
    if (!confirm(`Passer cet utilisateur en ${newRole.toUpperCase()} ?`)) return;

    try {
        await updateDoc(doc(db, "players", uid), { role: newRole });
        window.showPopup("Succès", `Rôle mis à jour : ${newRole}`);
        loadAllPlayers();
    } catch (e) {
        window.showPopup("Erreur", e.message);
    }
};

window.resetCooldown = async (uid, email) => {
    try {
        // Reset cooldowns pour toutes les générations
        const packsByGen = {};
        for (let i = 1; i <= 7; i++) {
            packsByGen[`gen${i}`] = {
                availablePacks: 3,
                lastDrawTime: 0,
                points: 0,
                bonusPacks: 0
            };
        }
        packsByGen['special_bryan'] = {
            availablePacks: 3,
            lastDrawTime: 0,
            points: 0,
            bonusPacks: 0
        };

        await updateDoc(doc(db, "players", uid), {
            packsByGen: packsByGen,
                adminNotification: {
                type: 'cooldown_reset',
                message: '<img src="assets/icons/zap.svg" class="title-icon" alt="zap"> Tous vos cooldowns ont été réinitialisés par un administrateur !',
                timestamp: Date.now()
            }
        });
        window.showPopup("Succès", `Tous les cooldowns reset pour ${email}`); 
        loadAllPlayers(); 
    } catch (e) { 
        window.showPopup("Erreur", e.message); 
    }
};

window.resetPlayer = async (uid, email) => {
    if (!confirm(`Vider tout le deck de ${email} ?`)) return;
    try { 
        await updateDoc(doc(db, "players", uid), { 
            collection: [], 
            lastDrawTime: 0, 
            packsByGen: {} 
        }); 
        window.showPopup("Succès", "Deck vidé."); 
        loadAllPlayers(); 
    } catch (e) { 
        window.showPopup("Erreur", e.message); 
    }
};

window.deleteAccount = async (uid, email) => {
    if (!confirm(`SUPPRIMER DÉFINITIVEMENT ${email} ?`)) return;
    try { await deleteDoc(doc(db, "players", uid)); window.showPopup("Adieu", "Compte supprimé."); loadAllPlayers(); } catch (e) { window.showPopup("Erreur", e.message); }
};