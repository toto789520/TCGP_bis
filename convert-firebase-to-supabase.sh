#!/bin/bash
# Script to help convert Firebase calls to Supabase in script.js

# Backup the current file
cp script.js script.js.temp

# Replace common patterns
sed -i 's/auth\.currentUser/await getCurrentUser()/g' script.js.temp
sed -i 's/user\.uid/user.id/g' script.js.temp

# Replace Firebase field names with Supabase (snake_case)
sed -i 's/packsByGen/packs_by_gen/g' script.js.temp
sed -i 's/lastDrawTime/last_draw_time/g' script.js.temp
sed -i 's/availablePacks/available_packs/g' script.js.temp
sed -i 's/bonusPacks/bonus_packs/g' script.js.temp
sed -i 's/boosterRevealedCards/booster_revealed_cards/g' script.js.temp
sed -i 's/currentBooster/current_booster/g' script.js.temp
sed -i 's/adminNotification/admin_notification/g' script.js.temp
sed -i 's/notificationsEnabled/notifications_enabled/g' script.js.temp

# Show differences
diff -u script.js script.js.temp | head -50

