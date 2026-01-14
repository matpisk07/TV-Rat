import express from 'express';
import bodyParser from 'body-parser';
import pkg from 'leboncoin-api-search';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// --- CONFIGURATION ---
const PORT = 3000;
const INTERVAL_MINUTES = 60;
const MIN_SCAN_INTERVAL = 15;
const CLEANUP_DAYS = 31;
const POSITIVES_FILE = './positives.json';
const NEGATIVES_FILE = './negatives.json';
const MEMORY_FILE = 'memoire_annonces.json';
const IMAGE_FILE = 'tvrat.png';

const PARIS_COORDS = { lat: 48.852968, lng: 2.349902 };

// --- INITIALISATION ---
const leboncoin = pkg.default || pkg;
const search = leboncoin.search;
const app = express();
app.use(bodyParser.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TARGET_CATEGORIES = [
    { id: "14", name: "Electronique" },
    { id: "15", name: "Ordinateurs" },
    { id: "16", name: "Photo/Video" },
    { id: "83", name: "Accessoires" }
];

// CACHE RAM
let MEMORY_CACHE = []; 
let nextScanTime = Date.now();
let lastScanTime = 0;
let isScanning = false;

// --- ROUTES ---
app.get('/tvrat.png', (req, res) => {
    const imgPath = path.join(__dirname, IMAGE_FILE);
    if (fs.existsSync(imgPath)) res.sendFile(imgPath); else res.sendStatus(404);
});
app.get('/favicon.ico', (req, res) => {
    const imgPath = path.join(__dirname, IMAGE_FILE);
    if (fs.existsSync(imgPath)) res.sendFile(imgPath); else res.sendStatus(404);
});

// --- OUTILS ---
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return 9999;
    const R = 6371;
    const dLat = deg2rad(lat2 - lat1);
    const dLon = deg2rad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.floor(R * c);
}
function deg2rad(deg) { return deg * (Math.PI / 180); }

function loadJson(file) {
    if (!fs.existsSync(file)) { fs.writeFileSync(file, '[]'); return []; }
    try { const c = fs.readFileSync(file, 'utf-8'); return c.trim() ? JSON.parse(c) : []; } catch (e) { return []; }
}
function saveJson(file, data) { try { fs.writeFileSync(file, JSON.stringify(data, null, 2)); } catch (e) {} }

// --- IA ---
class MiniBrain {
    constructor() {
        this.wordCounts = { pos: {}, neg: {} };
        this.totalDocs = { pos: 0, neg: 0 };
        this.vocab = new Set();
        this.reload();
    }
    tokenize(text) { return (text || "").toLowerCase().replace(/[^a-z0-9àâçéèêëîïôûùüÿñæoe\s]/g, '').split(/\s+/).filter(w => w.length > 2); }
    train(text, label) {
        const tokens = this.tokenize(text);
        this.totalDocs[label]++;
        tokens.forEach(token => {
            this.vocab.add(token);
            this.wordCounts[label][token] = (this.wordCounts[label][token] || 0) + 1;
        });
    }
    predict(text) {
        const tokens = this.tokenize(text);
        let scorePos = 0, scoreNeg = 0;
        tokens.forEach(token => {
            const countPos = (this.wordCounts.pos[token] || 0) + 1;
            const countNeg = (this.wordCounts.neg[token] || 0) + 1;
            scorePos += Math.log(countPos / (this.totalDocs.pos + this.vocab.size));
            scoreNeg += Math.log(countNeg / (this.totalDocs.neg + this.vocab.size));
        });
        const res = Math.exp(scorePos) / (Math.exp(scorePos) + Math.exp(scoreNeg));
        return isNaN(res) ? 0.5 : res;
    }
    reload() {
        this.wordCounts = { pos: {}, neg: {} }; this.totalDocs = { pos: 0, neg: 0 }; this.vocab = new Set();
        const pos = loadJson(POSITIVES_FILE); const neg = loadJson(NEGATIVES_FILE);
        pos.forEach(t => this.train(t, 'pos')); neg.forEach(t => this.train(t, 'neg'));
        console.log(`[IA] Cerveau rechargé.`);
    }
}
const brain = new MiniBrain();

// --- SCANNER ---
async function scanLeboncoin() {
    if (isScanning) return;
    isScanning = true;
    lastScanTime = Date.now();
    
    console.log(`[BOT] Scan en cours (0€ à 50€)...`);
    nextScanTime = Date.now() + (INTERVAL_MINUTES * 60 * 1000);

    let seenAds = MEMORY_CACHE;
    const now = Date.now();
    const expiryMs = CLEANUP_DAYS * 24 * 60 * 60 * 1000;
    
    // Nettoyage RAM
    const initialCount = seenAds.length;
    seenAds = seenAds.filter(a => {
        if (!a.discovered_at) a.discovered_at = now;
        return (now - a.discovered_at) < expiryMs;
    });
    if (seenAds.length < initialCount) console.log(`[NETTOYAGE] ${initialCount - seenAds.length} supprimés.`);

    let seenIds = new Set(seenAds.map(a => a.list_id));
    let newAdsCount = 0;

    const strategies = [
        { params: { price_min: 0, price_max: 0 } }, 
        { params: { keywords: "don" } }, 
        { params: { price_min: 1, price_max: 50 } }
    ];

    for (const cat of TARGET_CATEGORIES) {
        for (const strat of strategies) {
            try {
                const results = await search({ category: cat.id, sort_by: "time", sort_order: "desc", locations: [], limit: 35, ...strat.params });
                for (const ad of results.ads) {
                    if (seenIds.has(ad.list_id)) continue;
                    
                    const price = ad.price !== undefined ? ad.price : 0;
                    if (price <= 50) {
                        let imgUrl = null;
                        if (ad.images && ad.images.small_url) imgUrl = ad.images.small_url;
                        else if (ad.images && ad.images.urls && ad.images.urls.length > 0) imgUrl = ad.images.urls[0];
                        // --- AJOUTE CE BLOC ICI ---
                        // CORRECTION SSL : On force HTTPS pour l'image
                        if (imgUrl && imgUrl.startsWith('http://')) {
                            imgUrl = imgUrl.replace('http://', 'https://');
                        }

                        let dist = 9999;
                        if (ad.location && ad.location.lat && ad.location.lng) dist = getDistanceFromLatLonInKm(PARIS_COORDS.lat, PARIS_COORDS.lng, ad.location.lat, ad.location.lng);

                        const fullAd = {
                            list_id: ad.list_id, subject: ad.subject || "Sans Titre", price: price, url: ad.url,
                            location: ad.location, distanceFromParis: dist, first_publication_date: ad.first_publication_date,
                            discovered_at: Date.now(), image: imgUrl, aiScore: 0, userVote: null 
                        };
                        seenAds.push(fullAd); seenIds.add(ad.list_id); newAdsCount++;
                    }
                }
            } catch (e) {}
            await new Promise(r => setTimeout(r, 200));
        }
    }

    seenAds = seenAds.map(ad => {
        ad.aiScore = Math.round(brain.predict(ad.subject || "") * 100);
        return ad;
    });

    MEMORY_CACHE = seenAds;
    saveJson(MEMORY_FILE, seenAds);
    console.log(`[BOT] Terminé. ${newAdsCount} nouveautés. Total: ${seenAds.length}`);
    isScanning = false;
    return newAdsCount;
}

// --- API ---
console.log("[INIT] Chargement RAM...");
MEMORY_CACHE = loadJson(MEMORY_FILE);
console.log(`[INIT] Prêt avec ${MEMORY_CACHE.length} annonces.`);

app.get('/api/annonces', (req, res) => {
    let ads = [...MEMORY_CACHE];
    
    const maxDist = parseInt(req.query.dist) || 9999;
    if (maxDist !== 9999) ads = ads.filter(a => (a.distanceFromParis || 9999) <= maxDist);

    const maxPrice = parseInt(req.query.price);
    if (!isNaN(maxPrice)) {
        if (maxPrice === 0) ads = ads.filter(a => a.price === 0);
        else ads = ads.filter(a => a.price <= maxPrice);
    }

    ads.sort((a, b) => (b.aiScore || 0) - (a.aiScore || 0));
    res.json({ ads: ads, nextScan: nextScanTime });
});

app.post('/api/refresh', async (req, res) => {
    if (isScanning) return res.json({ status: 'busy' });
    const min = (Date.now() - lastScanTime) / 1000 / 60;
    if (lastScanTime !== 0 && min < MIN_SCAN_INTERVAL) return res.json({ status: 'cooldown', message: `Attente: ${Math.ceil(MIN_SCAN_INTERVAL - min)} min.` });
    const count = await scanLeboncoin();
    res.json({ status: 'ok', count: count });
});

app.post('/api/vote', (req, res) => {
    const { id, title, type } = req.body; 
    if (!title) return res.json({ status: 'error' });

    const targetFile = type === 'pos' ? POSITIVES_FILE : NEGATIVES_FILE;
    const oppositeFile = type === 'pos' ? NEGATIVES_FILE : POSITIVES_FILE;

    let targetList = loadJson(targetFile);
    if (!targetList.includes(title)) { targetList.push(title); saveJson(targetFile, targetList); }
    let oppositeList = loadJson(oppositeFile);
    if (oppositeList.includes(title)) { oppositeList = oppositeList.filter(t => t !== title); saveJson(oppositeFile, oppositeList); }

    brain.reload();
    MEMORY_CACHE = MEMORY_CACHE.map(ad => {
        if (ad.list_id === id) ad.userVote = type; 
        ad.aiScore = Math.round(brain.predict(ad.subject || "") * 100);
        return ad;
    });
    saveJson(MEMORY_FILE, MEMORY_CACHE);
    res.json({ status: 'ok' });
});

// --- FRONTEND OPTIMISÉ ---
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="fr" class="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TV Rat by Mattia</title>
    <link rel="icon" type="image/png" href="/tvrat.png">
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <script>tailwind.config = { theme: { extend: { colors: { 'lbc': '#ff6e14' } } } }</script>
    <style>
        .card-img { height: 180px; object-fit: cover; width: 100%; transition: transform 0.3s; }
        .group:hover .card-img { transform: scale(1.05); }
        .no-img { height: 180px; background: #2d3748; display: flex; align-items: center; justify-content: center; color: #718096; }
        .timer-badge { font-variant-numeric: tabular-nums; }
        .btn-pos-active { color: #4ade80 !important; font-weight: bold; transform: scale(1.1); }
        .btn-neg-active { color: #f87171 !important; font-weight: bold; transform: scale(1.1); }
        .treated-card { opacity: 0.5; transition: opacity 0.3s; }
        .treated-card:hover { opacity: 1 !important; }
        
        /* Spinner */
        .loader { border: 4px solid #f3f3f3; border-top: 4px solid #ff6e14; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 50px auto; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
</head>
<body class="bg-gray-900 text-gray-100 min-h-screen font-sans flex flex-col">
    <header class="bg-gray-800 border-b border-gray-700 p-4 sticky top-0 z-50 shadow-lg backdrop-blur-md bg-opacity-95">
        <div class="container mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
            <div class="flex items-center gap-4 flex-wrap">
                <h1 class="text-2xl font-bold text-white flex items-center">
                    <img src="/tvrat.png" alt="Logo" class="h-10 w-auto mr-3"> TV Rat by Mattia
                </h1>
                
                <select id="distFilter" onchange="loadData()" class="bg-gray-700 text-white text-sm rounded border border-gray-600 px-2 py-1 focus:outline-none focus:border-lbc">
                    <option value="9999">🌍 Partout</option>
                    <option value="10">🚗 < 10 km</option>
                    <option value="20">🚗 < 20 km</option>
                    <option value="50">🚗 < 50 km</option>
                    <option value="100">🚗 < 100 km</option>
                </select>

                <select id="priceFilter" onchange="loadData()" class="bg-gray-700 text-white text-sm rounded border border-gray-600 px-2 py-1 focus:outline-none focus:border-lbc">
                    <option value="0" selected>🎁 Gratuit</option>
                    <option value="10">💰 < 10 €</option>
                    <option value="20">💰 < 20 €</option>
                    <option value="30">💰 < 30 €</option>
                    <option value="50">💰 < 50 €</option>
                </select>
            </div>

            <div class="flex items-center gap-4">
                <div class="bg-gray-700 px-3 py-1 rounded text-xs text-gray-300 flex items-center gap-2 border border-gray-600">
                    <i class="fas fa-hourglass-half"></i> <span id="countdown" class="font-mono text-white font-bold timer-badge">--:--</span>
                </div>
                <button id="refreshBtn" onclick="triggerScan()" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded-full transition shadow text-sm font-semibold flex items-center"><i class="fas fa-sync-alt mr-2" id="refreshIcon"></i> <span id="refreshText">Actualiser</span></button>
            </div>
        </div>
    </header>

    <main class="container mx-auto p-4 flex-1">
        <div id="stats" class="text-gray-400 mb-6 text-sm flex justify-between">Prêt.</div>
        <div id="grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"></div>
    </main>

    <script>
        let nextScanTimestamp = 0;
        let countdownInterval;

        function getVisitedAds() { try { return (JSON.parse(localStorage.getItem('visited_ads')) || []).map(String); } catch { return []; } }
        function markAsVisited(id) {
            const strId = String(id);
            const visited = getVisitedAds();
            if (!visited.includes(strId)) {
                visited.push(strId);
                localStorage.setItem('visited_ads', JSON.stringify(visited));
                const card = document.getElementById('card-' + id);
                if (card) card.classList.add('treated-card');
            }
        }

        function startTimer() {
            if (countdownInterval) clearInterval(countdownInterval);
            const el = document.getElementById('countdown');
            countdownInterval = setInterval(() => {
                const now = Date.now();
                const diff = nextScanTimestamp - now;
                if (diff <= 0) el.innerText = "Wait...";
                else {
                    const m = Math.floor(diff / 60000);
                    const s = Math.floor((diff % 60000) / 1000);
                    el.innerText = \`\${m}m \${s < 10 ? '0' : ''}\${s}s\`;
                }
            }, 1000);
        }

        async function loadData() {
            const grid = document.getElementById('grid');
            const stats = document.getElementById('stats');
            
            // Afficher le loader tout de suite
            grid.innerHTML = '<div class="col-span-full"><div class="loader"></div><p class="text-center text-gray-500">Chargement ultra-rapide...</p></div>';

            try {
                const dist = document.getElementById('distFilter').value;
                const price = document.getElementById('priceFilter').value;
                
                const res = await fetch(\`/api/annonces?dist=\${dist}&price=\${price}\`);
                const data = await res.json();
                nextScanTimestamp = data.nextScan; startTimer();
                const ads = data.ads;
                const localVisited = getVisitedAds();
                
                stats.innerHTML = \`<span>\${ads.length} annonce(s) trouvée(s)</span>\`;

                if (ads.length === 0) { 
                    grid.innerHTML = '<div class="col-span-full text-center py-20 text-gray-500">Aucune annonce.</div>'; 
                    return; 
                }

                // CONSTRUCTION DU HTML EN BATCH (Beaucoup plus rapide)
                let fullHtml = '';

                ads.forEach(ad => {
                    let scoreColor = 'bg-gray-600';
                    const score = ad.aiScore || 0;
                    if(score > 50) scoreColor = 'bg-blue-600';
                    if(score > 80) scoreColor = 'bg-purple-600';
                    if(score > 95) scoreColor = 'bg-lbc';

                    const imgHtml = ad.image ? \`<img src="\${ad.image}" class="card-img" alt="Image" loading="lazy">\` : \`<div class="no-img"><i class="fas fa-camera-slash fa-2x"></i></div>\`;
                    let displayPrice = ad.price > 0 ? ad.price + " €" : "GRATUIT";
                    const safeTitle = (ad.subject || "Sans titre").replace(/'/g, "\\\\'");
                    const dateStr = ad.first_publication_date ? new Date(ad.first_publication_date).toLocaleDateString() : "-";
                    let distDisplay = (ad.distanceFromParis && ad.distanceFromParis < 9000) ? \`<span class="text-xs bg-gray-700 px-1.5 py-0.5 rounded text-gray-300 ml-2"><i class="fas fa-car-side"></i> \${ad.distanceFromParis} km</span>\` : "";

                    let cardClass = "";
                    const hasVoted = (ad.userVote === 'pos' || ad.userVote === 'neg');
                    const hasVisited = localVisited.includes(String(ad.list_id));
                    if (hasVoted || hasVisited) cardClass = "treated-card";

                    let btnPosClass = "text-gray-400";
                    let btnNegClass = "text-gray-400";
                    if (ad.userVote === 'pos') btnPosClass = "btn-pos-active";
                    if (ad.userVote === 'neg') btnNegClass = "btn-neg-active";

                    fullHtml += \`
                    <div id="card-\${ad.list_id}" class="bg-gray-800 rounded-xl overflow-hidden shadow-lg border border-gray-700 flex flex-col hover:border-lbc transition relative group \${cardClass}">
                        <a href="\${ad.url}" target="_blank" onclick="markAsVisited(\${ad.list_id})" class="block relative overflow-hidden">
                            \${imgHtml}
                            <div class="absolute top-2 right-2 \${scoreColor} text-white text-xs font-bold px-2 py-1 rounded shadow flex items-center gap-1">\${score}%</div>
                        </a>
                        <div class="p-4 flex-1 flex flex-col">
                            <div class="flex justify-between items-start mb-2"><span class="text-lbc font-extrabold text-lg">\${displayPrice}</span><span class="text-xs text-gray-500">\${dateStr}</span></div>
                            <a href="\${ad.url}" target="_blank" onclick="markAsVisited(\${ad.list_id})" class="hover:text-lbc transition"><h3 class="font-bold text-lg leading-tight mb-1 line-clamp-2">\${ad.subject || "Sans titre"}</h3></a>
                            <div class="text-gray-400 text-sm mb-4 flex items-center flex-wrap"><i class="fas fa-map-marker-alt mr-1"></i> \${ad.location ? ad.location.city : "France"} \${distDisplay}</div>
                            
                            <div class="mt-auto pt-4 border-t border-gray-700 flex justify-between items-center">
                                <div class="flex bg-gray-900 rounded-lg p-1 gap-1 w-full justify-between">
                                    <button id="btn-neg-\${ad.list_id}" onclick="vote(\${ad.list_id}, '\${safeTitle}', 'neg')" class="flex-1 hover:bg-gray-800 p-2 rounded transition text-center \${btnNegClass}">
                                        <i class="fas fa-thumbs-down"></i>
                                    </button>
                                    <button id="btn-pos-\${ad.list_id}" onclick="vote(\${ad.list_id}, '\${safeTitle}', 'pos')" class="flex-1 hover:bg-gray-800 p-2 rounded transition text-center \${btnPosClass}">
                                        <i class="fas fa-thumbs-up"></i>
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>\`;
                });

                // INJECTION UNIQUE (C'est la clé de la vitesse)
                grid.innerHTML = fullHtml;

            } catch (e) { console.error(e); }
        }

        async function triggerScan() {
            const btn = document.getElementById('refreshBtn');
            const icon = document.getElementById('refreshIcon');
            btn.classList.add('opacity-50', 'cursor-not-allowed'); icon.classList.add('fa-spin'); 
            try { 
                const res = await fetch('/api/refresh', { method: 'POST' }); 
                const data = await res.json(); 
                if (data.status === 'cooldown') alert(data.message);
                else if (data.status === 'busy') alert("Scan déjà en cours...");
                else loadData(); 
            } catch(e) {}
            btn.classList.remove('opacity-50', 'cursor-not-allowed'); icon.classList.remove('fa-spin');
        }

        async function vote(id, title, type) {
            const btnPos = document.getElementById('btn-pos-' + id);
            const btnNeg = document.getElementById('btn-neg-' + id);
            btnPos.className = "flex-1 hover:bg-gray-800 p-2 rounded transition text-center text-gray-400";
            btnNeg.className = "flex-1 hover:bg-gray-800 p-2 rounded transition text-center text-gray-400";
            if (type === 'pos') btnPos.classList.add('btn-pos-active');
            if (type === 'neg') btnNeg.classList.add('btn-neg-active');
            const card = document.getElementById('card-' + id);
            if(card) card.classList.add('treated-card');
            await fetch('/api/vote', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ id, title, type }) });
        }

        loadData();
    </script>
</body>
</html>
    `);
});

setInterval(scanLeboncoin, INTERVAL_MINUTES * 60 * 1000);
scanLeboncoin();
app.listen(PORT, () => { console.log(`🚀 TV RAT ONLINE - http://localhost:${PORT}`); });
