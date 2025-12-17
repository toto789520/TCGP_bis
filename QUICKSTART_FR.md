# 🚀 Démarrage Rapide - Migration Supabase

## En 5 minutes chrono ⏱️

### Étape 1: Récupérer votre clé API (2 min)

1. Allez sur: https://supabase.com/dashboard/project/ilcgojhgforbqiyvlwvb
2. Cliquez sur **Settings** (⚙️) → **API**
3. Copiez la clé **anon public** (commence par `eyJ...`)

### Étape 2: Configurer le projet (1 min)

**Important**: Pour la sécurité, le fichier `supabase-config.js` est maintenant dans `.gitignore`. 

Éditez `supabase-config.js` et remplacez:
```javascript
anonKey: 'YOUR_SUPABASE_ANON_KEY_HERE'
```
par votre clé (collez la clé copiée à l'étape 1).

💡 **Astuce**: Si le fichier n'existe pas, copiez `supabase-config.js.template`:
```bash
cp supabase-config.js.template supabase-config.js
```
Puis éditez-le avec votre clé.

### Étape 3: Créer les tables (2 min)

1. Dans Supabase, cliquez sur **SQL Editor** (🗄️)
2. Cliquez sur **+ New query**
3. Ouvrez le fichier `supabase-schema.sql`
4. Copiez TOUT son contenu
5. Collez dans l'éditeur SQL
6. Cliquez sur **Run** (ou `Ctrl+Enter`)
7. ✅ Vous devez voir "Success. No rows returned"

### Étape 4: Activer Google OAuth (Optionnel)

#### Option rapide (recommandée pour tester):
1. Dans Supabase: **Authentication** → **Providers**
2. Activez **Google**
3. Cochez **"Use Supabase OAuth provider"**
4. Sauvegardez

#### URLs de redirection:
Dans **Authentication** → **URL Configuration**:
- **Site URL**: `https://bryandrouet.github.io/TCGP`
- **Redirect URLs**: Ajoutez vos URLs (localhost + production)

### Étape 5: Tester ! 🎮

1. Ouvrez `index.html` dans votre navigateur
2. Essayez de vous connecter:
   - Avec Google (si configuré)
   - Ou créez un compte email/password
3. Testez d'ouvrir un booster
4. ✅ Vérifiez que tout fonctionne !

---

## ⚡ Import des données (Optionnel)

Si vous voulez récupérer vos données Firebase:

1. Ouvrez `migrate-data.html` dans votre navigateur
2. Sélectionnez `backups/backup_players.json`
3. Cliquez sur **"Importer les joueurs"**
4. Attendez la fin de l'import
5. ⚠️ Les utilisateurs doivent se reconnecter pour voir leurs données

---

## 🆘 Ça ne marche pas ?

### Erreur "Invalid API key"
→ Vérifiez que vous avez bien copié la clé **anon public** (pas service_role)

### Erreur "relation players does not exist"
→ Vous n'avez pas exécuté le script SQL. Retournez à l'étape 3.

### Google Auth ne marche pas
→ Vérifiez que vous avez activé le provider Google dans Authentication

### Les données ne se sauvegardent pas
→ Ouvrez la console (F12) et vérifiez les erreurs
→ Vérifiez que les tables sont créées

### Page blanche
→ Vérifiez que `supabase-config.js` est bien configuré
→ Ouvrez la console (F12) pour voir l'erreur

---

## 📚 Documentation complète

Pour plus de détails, consultez:
- **`SETUP_SUPABASE.md`** - Guide complet avec captures d'écran
- **`MIGRATION_SUMMARY.md`** - Résumé de la migration
- **`SUPABASE_MIGRATION.md`** - Documentation technique

---

## ✅ Checklist

- [ ] Clé API configurée dans `supabase-config.js`
- [ ] Script SQL exécuté (tables créées)
- [ ] Google OAuth activé (optionnel)
- [ ] URLs de redirection configurées
- [ ] Application testée et fonctionnelle
- [ ] Données importées (optionnel)

**🎊 C'est tout ! Votre application utilise maintenant Supabase !**
