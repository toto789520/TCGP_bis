const GENS = [
    { id: "gen1", name: "Gen 1 (Kanto)", start: 1, end: 151 },
    { id: "gen2", name: "Gen 2 (Johto)", start: 152, end: 251 },
    { id: "gen3", name: "Gen 3 (Hoenn)", start: 252, end: 386 },
    { id: "gen4", name: "Gen 4 (Sinnoh)", start: 387, end: 493 },
    { id: "gen5", name: "Gen 5 (Unys)", start: 494, end: 649 },
    { id: "gen6", name: "Gen 6 (Kalos)", start: 650, end: 721 },
    { id: "gen7", name: "Gen 7 (Alola)", start: 722, end: 809 }
];

const TYPE_TRANSLATION = {
    "Fire": "Fire", "Water": "Water", "Grass": "Grass", "Electric": "Electric",
    "Psychic": "Psychic", "Fighting": "Fighting", "Dark": "Darkness", "Steel": "Metal",
    "Fairy": "Fairy", "Dragon": "Dragon", "Normal": "Normal", "Ground": "Ground",
    "Flying": "Flying", "Bug": "Bug", "Rock": "Rock", "Ghost": "Ghost",
    "Poison": "Poison", "Ice": "Ice"
};

const ui = {
    toast: document.getElementById('dl-toast'),
    title: document.getElementById('toast-title'),
    msg: document.getElementById('toast-msg'),
    bar: document.getElementById('toast-bar'),
    show: () => { if(ui.toast) ui.toast.style.display = 'block'; },
    hide: () => { if(ui.toast) setTimeout(() => ui.toast.style.display = 'none', 5000); },
    update: (title, message, percent) => {
        if(ui.title) ui.title.innerText = title;
        if(ui.msg) ui.msg.innerText = message;
        if(ui.bar) ui.bar.style.width = percent + "%";
    }
};

window.downloadAllGensZip = async () => {
    console.clear();
    const btn = document.querySelector('.btn-admin');
    if(btn) btn.disabled = true;
    ui.show();
    ui.update("Connexion", "Récupération données...", 10);

    try {
        const zip = new JSZip();
        const rootFolder = zip.folder("data");

        const response = await fetch('https://raw.githubusercontent.com/fanzeyi/pokemon.json/master/pokedex.json');
        if (!response.ok) throw new Error("Erreur GitHub");
        const rawData = await response.json();

        // Vérification des données
        if(!rawData || rawData.length === 0) throw new Error("Données vides reçues !");

        let totalCards = 0;

        for (let i = 0; i < GENS.length; i++) {
            const gen = GENS[i];
            const percent = 20 + Math.floor(((i + 1) / GENS.length) * 60);
            ui.update(gen.name, `Génération des fichiers...`, percent);

            const genData = rawData.filter(p => p.id >= gen.start && p.id <= gen.end);
            
            if(genData.length > 0) {
                const processedCards = genData.map(p => processPokemon(p));
                totalCards += processedCards.length;

                const genFolder = rootFolder.folder(gen.id);
                
                // On s'assure d'écrire les fichiers même vides pour éviter les erreurs 404
                saveJsonToZip(genFolder, processedCards, 'common', 'common.json');
                saveJsonToZip(genFolder, processedCards, 'uncommon', 'uncommon.json');
                saveJsonToZip(genFolder, processedCards, 'rare', 'rare.json');
                saveJsonToZip(genFolder, processedCards, 'ultra_rare', 'ultra_rare.json');
                saveJsonToZip(genFolder, processedCards, 'secret', 'secret.json');
            }
        }

        ui.update("Compression", "Création ZIP...", 90);
        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, "tcg-fixed-data.zip");
        ui.update("Terminé !", "Téléchargement lancé.", 100);
        ui.hide();

    } catch (e) {
        console.error(e);
        ui.update("Erreur", e.message, 0);
        alert("Erreur : " + e.message);
    } finally {
        if(btn) btn.disabled = false;
    }
};

function processPokemon(p) {
    // CORRECTION MAJEURE ICI : Accès aux propriétés avec espaces
    const stats = p.base;
    const hp = stats["HP"] * 2; 
    const atk = stats["Attack"];
    const def = stats["Defense"];
    const spatk = stats["Sp. Attack"]; // C'était ça le bug (le point et l'espace)
    const spdef = stats["Sp. Defense"];
    const spd = stats["Speed"];

    const typeEn = p.type[0]; // Anglais direct depuis le JSON

    const attacks = [
        { name: "Attaque Rapide", cost: 1, damage: 10 },
        { name: "Coup Spécial", cost: 3, damage: Math.floor(atk / 1.5) + 20 }
    ];

    // Calcul du total des stats correctement
    const totalStats = stats["HP"] + atk + def + spatk + spdef + spd;
    let rarity = calculateRarity(p.id, totalStats);

    return {
        id: p.id,
        name: (p.name.french) ? p.name.french : p.name.english,
        hp: hp,
        types: [typeEn],
        image: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${p.id}.png`,
        attacks: attacks,
        weakness: "Standard",
        rarity_tag: rarity
    };
}

function calculateRarity(id, totalStats) {
    let rarity = "common";
    
    // Seuils ajustés pour être sûr d'avoir des rares
    if (totalStats >= 580) rarity = "secret";        // Légendaires majeurs
    else if (totalStats >= 500) rarity = "ultra_rare"; // Très forts / Starters finaux
    else if (totalStats >= 400) rarity = "rare";       // Évolutions
    else if (totalStats >= 300) rarity = "uncommon";   // Bases fortes

    // Exceptions manuelles (Starters)
    // Base (Bulbizarre...) -> Peu commune
    if ([1,4,7, 152,155,158, 252,255,258, 387,390,393, 495,498,501, 650,653,656, 722,725,728].includes(id)) rarity = "uncommon";
    // Finale (Florizarre...) -> Ultra Rare (Pour être sûr qu'ils ne soient pas justes "Rare")
    if ([3,6,9, 154,157,160, 254,257,260, 389,392,395, 497,500,503, 652,655,658, 724,727,730].includes(id)) rarity = "ultra_rare";
    // Légendaires iconiques -> Secret
    if ([150, 151, 249, 250, 251, 382, 383, 384].includes(id)) rarity = "secret";

    return rarity;
}

function saveJsonToZip(folder, allCards, tag, filename) {
    const filtered = allCards.filter(c => c.rarity_tag === tag);
    folder.file(filename, JSON.stringify(filtered, null, 2));
}