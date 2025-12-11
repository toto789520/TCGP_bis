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
    document.getElementById('popup-title').innerText = title;
    document.getElementById('popup-msg').innerText = msg;
    document.getElementById('custom-popup-overlay').style.display = 'flex';
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
            const lastDraw = data.lastDrawTime ? new Date(data.lastDrawTime).toLocaleTimeString() : "Dispo";
            const role = data.role || 'player';
            const roleColor = role === 'admin' ? '#ffd700' : '#ccc';
            const roleIcon = role === 'admin' ? '👑' : '👤';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${data.email}</strong></td>
                <td style="color:${roleColor}; font-weight:bold;">${roleIcon} ${role.toUpperCase()}</td>
                <td><span class="user-pill">🃏 ${data.collection ? data.collection.length : 0}</span></td>
                <td>${lastDraw}</td>
                <td>
                    <div>
                        <button onclick="toggleRole('${docSnap.id}', '${role}')" class="btn-action btn-role" style="background:#8e44ad">⬆️ Rôle</button>
                        <button onclick="resetCooldown('${docSnap.id}', '${data.email}')" class="btn-action btn-cooldown">⏳ Reset</button>
                        <button onclick="resetPlayer('${docSnap.id}', '${data.email}')" class="btn-action btn-reset">⚠️ Deck</button>
                        <button onclick="deleteAccount('${docSnap.id}', '${data.email}')" class="btn-action btn-delete">❌ DEL</button>
                    </div>
                </td>`;
            list.appendChild(tr);
        });
    } catch (e) { console.error(e); window.showPopup("Erreur", "Vérifie les droits BDD"); }
};

// CHANGER LE RÔLE (ADMIN <-> PLAYER)
window.toggleRole = async (uid, currentRole) => {
    const newRole = currentRole === 'admin' ? 'player' : 'admin';
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
    try { await updateDoc(doc(db, "players", uid), { lastDrawTime: 0 }); window.showPopup("Succès", `Timer reset pour ${email}`); loadAllPlayers(); } catch (e) { window.showPopup("Erreur", e.message); }
};

window.resetPlayer = async (uid, email) => {
    if (!confirm(`Vider tout le deck de ${email} ?`)) return;
    try { await updateDoc(doc(db, "players", uid), { collection: [], lastDrawTime: 0 }); window.showPopup("Succès", "Deck vidé."); loadAllPlayers(); } catch (e) { window.showPopup("Erreur", e.message); }
};

window.deleteAccount = async (uid, email) => {
    if (!confirm(`SUPPRIMER DÉFINITIVEMENT ${email} ?`)) return;
    try { await deleteDoc(doc(db, "players", uid)); window.showPopup("Adieu", "Compte supprimé."); loadAllPlayers(); } catch (e) { window.showPopup("Erreur", e.message); }
};