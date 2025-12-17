# Poké-TCG Ultimate

Retrouvez le jeu sur [https://bryandrouet.github.io/TCGP](https://bryandrouet.github.io/TCGP)

## 🚀 Migration vers Supabase

Ce projet a été migré de Firebase vers Supabase pour de meilleures performances et fonctionnalités.

### Configuration initiale

1. **Configurez vos clés API Supabase** dans `supabase-config.js`
2. **Exécutez le script SQL** `supabase-schema.sql` dans votre dashboard Supabase
3. **Suivez le guide complet** dans `SETUP_SUPABASE.md`

### Fichiers importants

- `SETUP_SUPABASE.md` - Guide de configuration complet
- `SUPABASE_MIGRATION.md` - Documentation de la migration
- `supabase-schema.sql` - Schéma de la base de données
- `migrate-data.html` - Outil d'import des données Firebase

### Backups

Les backups Firebase sont disponibles dans le dossier `backups/` :
- `backup_players.json` - Données des joueurs
- `backup_users_auth.json` - Authentification des utilisateurs  
- `backup_sessions.json` - Sessions actives

Pour plus d'informations, consultez `SETUP_SUPABASE.md`.