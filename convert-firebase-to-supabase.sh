#!/bin/bash
# Script to help convert Firebase calls to Supabase in script.js

# Backup the current file
cp script.js script.js.temp

# Replace common patterns
sed -i 's/auth\.currentUser/await getCurrentUser()/g' script.js.temp
sed -i 's/user\._id/user.id/g' script.js.temp

# Replace Firebase field names with Supabase (snake_case)
sed -i 's/packsByGen/packsbygen/g' script.js.temp
sed -i 's/lastDrawTime/lastdrawtime/g' script.js.temp
sed -i 's/availablePacks/availablepacks/g' script.js.temp
sed -i 's/bonusPacks/bonuspacks/g' script.js.temp
sed -i 's/boosterRevealedCards/boosterrevealedcards/g' script.js.temp
sed -i 's/currentBooster/currentbooster/g' script.js.temp
sed -i 's/adminNotification/admin_notification/g' script.js.temp
sed -i 's/notificationsEnabled/notifications_enabled/g' script.js.temp

# Show differences
diff -u script.js script.js.temp | head -50

