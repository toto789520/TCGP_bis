# Migration de Firebase vers Supabase

## Étape 1: Configuration de Supabase

### 1.1 Récupérer vos clés API

1. Allez sur votre dashboard Supabase: https://supabase.com/dashboard/project/ilcgojhgforbqiyvlwvb
2. Cliquez sur "Settings" (icône engrenage) dans le menu de gauche
3. Cliquez sur "API"
4. Copiez ces deux valeurs:
   - **URL du projet**: `https://ilcgojhgforbqiyvlwvb.supabase.co`
   - **anon public key**: Commencera par `eyJ...`

### 1.2 Mettre à jour la configuration

Éditez le fichier `supabase-config.js` et remplacez `YOUR_SUPABASE_ANON_KEY_HERE` par votre clé anon public.

## Étape 2: Créer les tables dans Supabase

### 2.1 Aller au SQL Editor

1. Dans votre dashboard Supabase
2. Cliquez sur "SQL Editor" dans le menu de gauche
3. Cliquez sur "New query"

### 2.2 Exécuter le script SQL

Copiez et collez le contenu du fichier `supabase-schema.sql` dans l'éditeur SQL et cliquez sur "Run".

Cela va créer:
- Table `players` pour les données des joueurs
- Table `sessions` pour les sessions
- Politiques de sécurité RLS (Row Level Security)

## Étape 3: Configurer l'authentification

### 3.1 Activer Google Auth dans Supabase

1. Dans votre dashboard Supabase
2. Allez dans "Authentication" > "Providers"
3. Activez "Google"
4. Vous devrez configurer OAuth avec:
   - Client ID de Google Cloud Console
   - Client Secret de Google Cloud Console

### 3.2 Configurer les URLs de redirection

Dans "Authentication" > "URL Configuration", ajoutez:
- `http://localhost:8080` (pour le développement local)
- `https://bryandrouet.github.io` (pour la production)
- Toute autre URL où votre application est hébergée

## Étape 4: Importer les données depuis les backups

### 4.1 Utiliser le script de migration

Le fichier `migrate-data.html` contient un outil pour importer vos données:

1. Ouvrez `migrate-data.html` dans votre navigateur
2. Cliquez sur "Import Players Data" et sélectionnez `backups/backup_players.json`
3. Attendez que l'import se termine

Note: L'authentification Google nécessite que les utilisateurs se reconnectent une fois pour créer leur compte Supabase Auth.

## Étape 5: Tester l'application

1. Ouvrez `index.html` dans votre navigateur
2. Testez la connexion avec Google
3. Testez l'ouverture de boosters
4. Vérifiez que les cartes sont sauvegardées

## Étape 6: Déployer en production

Une fois que tout fonctionne:

1. Commitez tous les changements
2. Poussez vers GitHub
3. GitHub Pages déploiera automatiquement la nouvelle version

## Notes importantes

### Différences entre Firebase et Supabase

1. **Authentification**: 
   - Firebase: `onAuthStateChanged`
   - Supabase: `onAuthStateChange` (presque identique)

2. **Base de données**:
   - Firebase: Firestore (NoSQL, collections/documents)
   - Supabase: PostgreSQL (SQL, tables/lignes)
   - Les données JSON de Firestore sont stockées dans des colonnes JSONB

3. **Sécurité**:
   - Firebase: Rules dans la console
   - Supabase: Row Level Security (RLS) policies en SQL

### Avantages de Supabase

- ✅ Base de données PostgreSQL complète
- ✅ API REST automatique
- ✅ Temps réel avec WebSockets
- ✅ Gratuit jusqu'à 500MB de base de données
- ✅ Backups automatiques
- ✅ Meilleure performance pour les requêtes complexes

### Support

Si vous avez des questions, consultez:
- Documentation Supabase: https://supabase.com/docs
- Documentation de l'API Auth: https://supabase.com/docs/reference/javascript/auth-signin
