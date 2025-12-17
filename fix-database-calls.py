#!/usr/bin/env python3
import re

with open('script.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace getDoc(doc(db, "players", uid)) with getPlayerDoc(uid)
content = re.sub(r'await getDoc\(doc\(db, "players", ([^)]+)\)\)', r'await getPlayerDoc(\1)', content)
content = re.sub(r'getDoc\(doc\(db, "players", ([^)]+)\)\)', r'getPlayerDoc(\1)', content)

# Replace snap.data().field with snap.data().field (already correct)
# But we need to handle the fact that snap.data() is now directly the data object

# Replace deleteDoc calls
content = re.sub(r'await deleteDoc\(doc\(db, "players", ([^)]+)\)\)', r'await deletePlayerDoc(\1)', content)
content = re.sub(r'await deleteDoc\(doc\(db, "sessions", ([^)]+)\)\)', r'await deleteSessionDoc(\1)', content)

# Replace updateDoc calls
content = re.sub(r'await updateDoc\(doc\(db, "players", ([^)]+)\), ([^)]+)\)', r'await updatePlayerDoc(\1, \2)', content)

# Replace auth references
content = re.sub(r'signOut\(auth\)', r'supabase.auth.signOut()', content)

# Fix getCurrentUser() calls that are now async
# Some patterns that need fixing
content = re.sub(r'const user = await getCurrentUser\(\);', r'const { data: { user } } = await supabase.auth.getUser();', content)

with open('script.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Database calls updated")
