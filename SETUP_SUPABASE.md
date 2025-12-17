# Guide de Configuration Supabase - TCGP

Ce guide vous aide à configurer votre projet pour utiliser Supabase au lieu de Firebase.

## 📋 Prérequis

- Un compte Supabase (gratuit)
- Accès à votre dashboard Supabase : https://supabase.com/dashboard/project/ilcgojhgforbqiyvlwvb

## 🚀 Étapes de Configuration

### Étape 1: Récupérer vos clés API Supabase

1. **Allez sur votre dashboard Supabase**
   - URL: https://supabase.com/dashboard/project/ilcgojhgforbqiyvlwvb
   
2. **Naviguez vers les paramètres API**
   - Cliquez sur l'icône ⚙️ **Settings** dans le menu de gauche
   - Cliquez sur **API** dans le sous-menu

3. **Copiez vos clés**
   Vous aurez besoin de deux informations :
   - **Project URL** : `https://ilcgojhgforbqiyvlwvb.supabase.co`
   - **anon public** key : Une longue clé commençant par `eyJ...`

### Étape 2: Configurer le fichier supabase-config.js

1. **Ouvrez le fichier `supabase-config.js`**

2. **Remplacez `YOUR_SUPABASE_ANON_KEY_HERE`** par votre clé anon public :

```javascript
export const SUPABASE_CONFIG = {
    url: 'https://ilcgojhgforbqiyvlwvb.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' // ← Collez votre clé ici
};
```

3. **Sauvegardez le fichier**

### Étape 3: Créer les tables dans Supabase

1. **Allez dans le SQL Editor de Supabase**
   - Dans votre dashboard, cliquez sur **SQL Editor** (🗄️) dans le menu de gauche

2. **Créez une nouvelle requête**
   - Cliquez sur **+ New query**

3. **Copiez le contenu du fichier `supabase-schema.sql`**
   - Ouvrez le fichier `supabase-schema.sql`
   - Copiez tout son contenu

4. **Exécutez le script**
   - Collez le contenu dans l'éditeur SQL
   - Cliquez sur **Run** ou appuyez sur `Ctrl+Enter`
   - Vous devriez voir : "Success. No rows returned"

5. **Vérifiez que les tables sont créées**
   - Cliquez sur **Table Editor** dans le menu de gauche
   - Vous devriez voir les tables : `players` et `sessions`

### Étape 4: Configurer l'authentification Google

1. **Activer le provider Google**
   - Dans votre dashboard Supabase
   - Allez dans **Authentication** > **Providers**
   - Trouvez **Google** et cliquez dessus

2. **Activer Google Auth**
   - Basculez le bouton pour activer Google

3. **Configurer les credentials OAuth**
   
   Vous avez deux options :

   **Option A: Utiliser les credentials Supabase (Recommandé pour débuter)**
   - Cochez "Use Supabase OAuth provider"
   - C'est plus simple mais limité

   **Option B: Utiliser vos propres credentials Google**
   - Allez sur [Google Cloud Console](https://console.cloud.google.com/)
   - Créez un nouveau projet ou sélectionnez un projet existant
   - Activez l'API Google+ 
   - Allez dans "Identifiants" > "Créer des identifiants" > "ID client OAuth 2.0"
   - Type d'application : Application Web
   - Ajoutez les URIs de redirection autorisées :
     ```
     https://ilcgojhgforbqiyvlwvb.supabase.co/auth/v1/callback
     ```
   - Copiez le **Client ID** et le **Client Secret**
   - Collez-les dans Supabase

4. **Configurer les URLs de redirection**
   - Dans **Authentication** > **URL Configuration**
   - **Site URL** : `https://bryandrouet.github.io/TCGP` (ou votre URL de production)
   - **Redirect URLs** : Ajoutez vos URLs autorisées :
     ```
     http://localhost:8080
     https://bryandrouet.github.io/TCGP
     https://bryandrouet.github.io
     ```

### Étape 5: Importer vos données (Optionnel)

Si vous avez des backups Firebase :

1. **Ouvrez `migrate-data.html`** dans votre navigateur

2. **Sélectionnez votre fichier backup**
   - Cliquez sur "Choisir un fichier"
   - Sélectionnez `backups/backup_players.json`

3. **Cliquez sur "Importer les joueurs"**
   - L'import va commencer
   - Attendez la fin du processus

⚠️ **Important** : Les utilisateurs devront se reconnecter après l'import pour lier leurs comptes.

### Étape 6: Tester l'application

1. **Ouvrez `index.html`** dans votre navigateur

2. **Testez la connexion**
   - Cliquez sur "Connexion Google"
   - Ou créez un compte avec email/password

3. **Vérifiez les fonctionnalités**
   - Ouvrir des boosters
   - Voir sa collection
   - Vérifier que les données sont sauvegardées

## 🎯 Checklist de vérification

- [ ] ✅ Clé API configurée dans `supabase-config.js`
- [ ] ✅ Tables créées dans Supabase (players, sessions)
- [ ] ✅ Google Auth activé et configuré
- [ ] ✅ URLs de redirection configurées
- [ ] ✅ Connexion Google fonctionnelle
- [ ] ✅ Connexion Email/Password fonctionnelle
- [ ] ✅ Sauvegarde des données OK
- [ ] ✅ Panneau admin accessible

## 🐛 Dépannage

### Erreur : "Invalid API key"
- Vérifiez que vous avez bien copié la clé **anon public** (pas la service_role)
- Vérifiez qu'il n'y a pas d'espaces avant/après la clé

### Erreur : "JWT expired" ou "Invalid JWT"
- Rechargez la page
- Videz le cache du navigateur
- Vérifiez que votre clé est à jour

### La connexion Google ne fonctionne pas
- Vérifiez que Google Auth est activé dans Supabase
- Vérifiez les URLs de redirection
- Si vous utilisez localhost, ajoutez `http://localhost:8080` dans les URLs autorisées

### Les données ne se sauvegardent pas
- Vérifiez que les tables sont créées
- Vérifiez les RLS policies (Row Level Security)
- Ouvrez la console du navigateur pour voir les erreurs

### Page blanche ou erreur de module
- Vérifiez que `supabase-config.js` est bien configuré
- Vérifiez qu'il n'y a pas d'erreur de syntaxe dans le fichier
- Ouvrez la console du navigateur (F12)

## 📚 Ressources

- [Documentation Supabase](https://supabase.com/docs)
- [Guide d'authentification](https://supabase.com/docs/guides/auth)
- [API JavaScript](https://supabase.com/docs/reference/javascript/introduction)
- [Dashboard Supabase](https://supabase.com/dashboard/project/ilcgojhgforbqiyvlwvb)

## ✨ Différences importantes Firebase → Supabase

### Base de données
- **Firebase** : Firestore (NoSQL, documents)
- **Supabase** : PostgreSQL (SQL, tables)
- Les données JSON sont stockées dans des colonnes JSONB

### Noms de champs (snake_case)
- `packsByGen` → `packs_by_gen`
- `lastDrawTime` → `last_draw_time`
- `availablePacks` → `available_packs`
- `bonusPacks` → `bonus_packs`

### Authentification
- Syntaxe similaire mais légèrement différente
- Google OAuth intégré
- Pas de redirection obligatoire sur mobile

### Avantages de Supabase
- ✅ PostgreSQL complet (SQL, relations, transactions)
- ✅ API REST et Realtime automatiques
- ✅ Meilleure performance
- ✅ Backups automatiques
- ✅ Gratuit jusqu'à 500MB
- ✅ Interface d'administration intuitive

## 🆘 Besoin d'aide ?

Si vous rencontrez des problèmes :
1. Vérifiez la console du navigateur (F12)
2. Consultez les logs dans le dashboard Supabase
3. Relisez ce guide étape par étape
4. Consultez la documentation Supabase

Bon courage ! 🚀
