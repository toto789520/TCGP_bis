import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore, doc, updateDoc, collection, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const ADMIN_EMAIL = "bryan.drouet24@gmail.com"; 

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

// GESTION POPUP
window.showPopup = (title, msg) => {
    document.getElementById('popup-title').innerText = title;
    document.getElementById('popup-msg').innerText = msg;
    document.getElementById('custom-popup-overlay').style.display = 'flex';
};
window.closePopup = () => { document.getElementById('custom-popup-overlay').style.display = 'none'; };

// VÉRIFICATION SÉCURITÉ AU CHARGEMENT
onAuthStateChanged(auth, (user) => {
    const loader = document.getElementById('global-loader');
    if (user) {
        if (user.email !== ADMIN_EMAIL) {
            alert("ACCÈS INTERDIT. REDIRECTION.");
            window.location.href = "index.html";
        } else {
            // C'est bien l'admin
            loader.style.display = 'none';
            loadAllPlayers();
        }
    } else {
        window.location.href = "index.html";
    }
});

// CHARGER LES JOUEURS
window.loadAllPlayers = async () => {
    const list = document.getElementById('players-list');
    list.innerHTML = '<tr><td colspan="5">Chargement...</td></tr>';

    try {
        const querySnapshot = await getDocs(collection(db, "players"));
        list.innerHTML = '';
        
        if (querySnapshot.empty) {
            list.innerHTML = '<tr><td colspan="5">Aucun joueur.</td></tr>';
            return;
        }

        querySnapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const lastDraw = data.lastDrawTime ? new Date(data.lastDrawTime).toLocaleString() : "Jamais";
            const cardCount = data.collection ? data.collection.length : 0;
            const uid = docSnap.id;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${data.email}</td>
                <td style="font-family:monospace; font-size:0.8em; color:#aaa;">${uid}</td>
                <td><strong>${cardCount}</strong> cartes</td>
                <td>${lastDraw}</td>
                <td>
                    <button onclick="resetPlayer('${uid}', '${data.email}')" class="btn-popup" style="background:#c0392b; font-size:0.8rem; padding:5px 10px;">⚠️ Reset Deck</button>
                </td>
            `;
            list.appendChild(tr);
        });
    } catch (e) {
        console.error(e);
        window.showPopup("Erreur Droits", "Impossible de lire la base. Vérifie les règles Firestore.");
    }
};

// RESET COMPTE
window.resetPlayer = async (uid, email) => {
    if (!confirm(`Confirmer la suppression de TOUTES les cartes de ${email} ?`)) return;

    try {
        await updateDoc(doc(db, "players", uid), {
            collection: [],
            lastDrawTime: 0 
        });
        window.showPopup("Succès", `Deck de ${email} vidé.`);
        loadAllPlayers();
    } catch (e) {
        window.showPopup("Erreur", e.message);
    }
};