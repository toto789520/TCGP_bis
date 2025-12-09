window.generateData = async () => {
    console.clear();
    console.log("🚀 Lancement du générateur FLASH (Source GitHub)...");
    const btn = document.querySelector('.btn-admin');
    if(btn) btn.innerText = "⏳ Téléchargement...";

    try {
        // 1. On récupère un "Pokedex" complet hébergé sur GitHub (C'est un seul gros fichier, donc pas de blocage !)
        // Ce fichier contient les stats et les noms en plusieurs langues (dont FR)
        const response = await fetch('https://raw.githubusercontent.com/fanzeyi/pokemon.json/master/pokedex.json');
        const rawData = await response.json();

        // 2. On filtre pour garder juste la Gen 1 (ID 1 à 151)
        // Pour avoir la Gen 2, remplace 151 par 251 ci-dessous !
        const gen1 = rawData.slice(0, 151); 

        const allCards = gen1.map(p => {
            // Conversion des données pour notre format TCG
            
            // Stats : On prend les HP de base * 2
            const hp = p.base.HP * 2;
            
            // Types : On garde le type en Anglais pour le CSS (ex: "Fire")
            // Le fichier source a les types en anglais, c'est parfait.
            const type = p.type[0]; 

            // Attaques (Simulation basée sur l'attaque du Pokémon)
            const attacks = [
                { name: "Charge", cost: 1, damage: 10 },
                { name: "Attaque Spéciale", cost: 3, damage: Math.floor(p.base.Attack / 1.5) + 10 }
            ];

            // Rareté (Logique personnalisée)
            let rarity = "common";
            // Si c'est un légendaire (Mewtwo, Mew, oiseaux) ou très fort
            if ([144,145,146,150,151].includes(p.id)) rarity = "secret";
            // Starter évolutions finales et Dragons
            else if ([3,6,9,149].includes(p.id) || p.base.HP > 90) rarity = "ultra_rare";
            // Évolutions intermédiaires
            else if (p.base.HP > 70) rarity = "rare";
            // Starters de base
            else if ([1,4,7,25].includes(p.id) || p.base.HP > 60) rarity = "uncommon";

            return {
                id: p.id,
                name: p.name.french, // Nom en Français direct !
                hp: hp,
                types: [type], // ex: ["Fire"]
                // On reconstruit l'URL de l'image officielle HD
                image: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${p.id}.png`,
                attacks: attacks,
                weakness: "Standard",
                rarity_tag: rarity
            };
        });

        // 3. Affichage des résultats pour copier-coller
        console.log("✅ TERMINÉ EN MOINS D'UNE SECONDE !");
        console.log("Copie les blocs ci-dessous dans tes fichiers JSON :");

        const show = (tag, filename) => {
            const filtered = allCards.filter(c => c.rarity_tag === tag);
            console.log(`\n⬇️ --- ${filename.toUpperCase()} (${filtered.length} cartes) --- ⬇️`);
            console.log(JSON.stringify(filtered, null, 2));
        };

        show('common', 'data/common.json');
        show('uncommon', 'data/uncommon.json');
        show('rare', 'data/rare.json');
        show('ultra_rare', 'data/ultra_rare.json');
        show('secret', 'data/secret.json');

        alert("Génération réussie ! Ouvre la console (F12) pour récupérer tes cartes.");

    } catch (e) {
        console.error("Erreur :", e);
        alert("Erreur de téléchargement. Vérifie ta connexion.");
    } finally {
        if(btn) btn.innerText = "Lancer la génération";
    }
};