import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_CONFIG } from './supabase-config.js';

const supabase = createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);

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

// Fonction de vérification des droits admin
async function checkAdminRights() {
    const loader = document.getElementById('global-loader');
    
    try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError) throw sessionError;
        
        const user = session?.user;
        if (!user) {
            window.location.href = "index.html";
            return;
        }

        const { data, error } = await supabase
            .from('players')
            .select('role')
            .eq('_id', user.id)
            .single();
            
        if (error) {
            console.error('Erreur lors de la vérification du rôle:', error);
            window.location.href = "index.html";
            return;
        }
        
        if (data && data.role === 'admin') {
            loader.style.display = 'none';
            loadAllPlayers();
        } else {
            window.location.href = "index.html"; // Pas admin -> Dehors
        }
    } catch (e) {
        console.error('Erreur lors de la vérification:', e);
        window.location.href = "index.html";
    }
}

// Vérifier immédiatement au chargement
checkAdminRights();

// VÉRIFICATION VIA BDD - écouter les changements d'auth
supabase.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_OUT') {
        window.location.href = "index.html";
    }
});

window.loadAllPlayers = async () => {
    const list = document.getElementById('players-list');
    list.innerHTML = '<tr><td colspan="5">Chargement...</td></tr>';

    try {
        const { data: players, error } = await supabase
            .from('players')
            .select('*')
            .order('createdat', { ascending: false });
            
        if (error) throw error;
        
        list.innerHTML = '';
        
        players.forEach((player) => {
            const role = player.role || 'player';
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
                <button onclick="resetCooldown('${player._id}', '${player.email}')" class="btn-action btn-cooldown"><img src="assets/icons/hourglass.svg" class="title-icon" alt="hourglass"> Reset</button>
                <button onclick="resetPlayer('${player._id}', '${player.email}')" class="btn-action btn-reset"><img src="assets/icons/triangle-alert.svg" class="title-icon" alt="warn"> Deck</button>
                <button onclick="deleteAccount('${player._id}', '${player.email}')" class="btn-action btn-delete"><img src="assets/icons/x.svg" class="title-icon" alt="del"> DEL</button>
            `;
            // Afficher le bouton rôle seulement si ce n'est pas un admin
            if (role !== 'admin') {
                let roleButtonEmoji = role === 'vip' ? '<img src="assets/icons/arrow-down-from-line.svg" class="title-icon" alt="down">' : '<img src="assets/icons/arrow-up-from-line.svg" class="title-icon" alt="up">';
                let roleButtonLabel = role === 'vip' ? 'Rétrograder' : 'VIP';
                actions = `<button onclick="toggleRole('${player._id}', '${role}')" class="btn-action btn-role" style="background:#8e44ad">${roleButtonEmoji} ${roleButtonLabel}</button>` + actions;
            }
            tr.innerHTML = `
                <td><strong>${player.email}</strong></td>
                <td>
                    <div class="col-role role-${role}" style="color:${roleColor}; font-weight:bold;">${roleIcon} ${role.toUpperCase()}</div>
                </td>
                <td><span class="user-pill">${player.collection ? player.collection.length : 0}</span></td>
                <td>
                    <div class="col-actions">
                        ${actions}
                    </div>
                </td>`;
            list.appendChild(tr);
        });
    } catch (e) { 
        console.error(e); 
        window.showPopup("Erreur", "Vérifie les droits BDD"); 
    }
};

// CHANGER LE RÔLE (ADMIN <-> PLAYER)
window.toggleRole = async (_id, currentRole) => {
    // Ne jamais changer le rôle d'un admin ici
    if (currentRole === 'admin') return;
    let newRole = 'vip';
    if (currentRole === 'vip') newRole = 'player';
    if (!confirm(`Passer cet utilisateur en ${newRole.toUpperCase()} ?`)) return;

    try {
        const { error } = await supabase
            .from('players')
            .update({ role: newRole })
            .eq('_id', _id);
            
        if (error) throw error;
        window.showPopup("Succès", `Rôle mis à jour : ${newRole}`);
        loadAllPlayers();
    } catch (e) {
        window.showPopup("Erreur", e.message);
    }
};

window.resetCooldown = async (_id, email) => {
    try {
        // Reset cooldowns pour toutes les générations
        const packsbygen = {};
        for (let i = 1; i <= 7; i++) {
            packsbygen[`gen${i}`] = {
                availablepacks: 3,
                lastdrawtime: 0,
                points: 0,
                bonuspacks: 0
            };
        }
        packsbygen['special_bryan'] = {
            availablepacks: 3,
            lastdrawtime: 0,
            points: 0,
            bonuspacks: 0
        };

        const { error } = await supabase
            .from('players')
            .update({
                packsbygen: packsbygen,
                admin_notification: {
                    type: 'cooldown_reset',
                    message: '<img src="assets/icons/zap.svg" class="title-icon" alt="zap"> Tous vos cooldowns ont été réinitialisés par un administrateur !',
                    timestamp: Date.now()
                }
            })
            .eq('_id', _id);
            
        if (error) throw error;
        window.showPopup("Succès", `Tous les cooldowns reset pour ${email}`); 
        loadAllPlayers(); 
    } catch (e) { 
        window.showPopup("Erreur", e.message); 
    }
};

window.resetPlayer = async (_id, email) => {
    if (!confirm(`Vider tout le deck de ${email} ?`)) return;
    try { 
        const { error } = await supabase
            .from('players')
            .update({ 
                collection: [], 
                lastdrawtime: 0, 
                packsbygen: {} 
            })
            .eq('_id', _id);
            
        if (error) throw error;
        window.showPopup("Succès", "Deck vidé."); 
        loadAllPlayers(); 
    } catch (e) { 
        window.showPopup("Erreur", e.message); 
    }
};

window.deleteAccount = async (_id, email) => {
    if (!confirm(`SUPPRIMER DÉFINITIVEMENT ${email} ?`)) return;
    try { 
        const { error } = await supabase
            .from('players')
            .delete()
            .eq('_id', _id);
            
        if (error) throw error;
        window.showPopup("Adieu", "Compte supprimé."); 
        loadAllPlayers(); 
    } catch (e) { 
        window.showPopup("Erreur", e.message); 
    }
};