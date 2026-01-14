# 🐀 TV Rat by Mattia

**TV Rat** est un **robot de recherche automatique** pour **Leboncoin**.
Au lieu de passer votre temps à rafraîchir la page, ce robot le fait pour vous : il scanne le site en permanence et vous trouve les meilleures affaires (0€ - 50€) dès qu'elles sont publiées.

Ce projet contient **un exemple complet de configuration** utilisé par une association étudiante pour trouver du matériel :
- 💻 Informatique (Ordinateurs, Composants)
- 🔌 Électronique
- 📷 Photo & Vidéo
- 🎧 Audio & Accessoires

## ✨ Ce que ça fait

- 🕵️ **Recherche 24h/24** : Le robot ne dort jamais. Il surveille les catégories définies en continu.
- 🧠 **Intelligence Artificielle** : Le robot apprend de vos goûts !
  - 👍 **Pouce levé** : Vous lui dites "Cherche plus de trucs comme ça".
  - 👎 **Pouce baissé** : Vous lui dites "Ça ne m'intéresse pas".
- 📍 **Calcul de Distance** : Il vous dit directement si c'est loin de chez vous (ou du local de l'asso).
- ⚡ **Site Web Facile** : Une interface simple et sombre (Dark Mode) pour voir les résultats sur votre téléphone ou ordi.

## 🤝 Crédits API

Ce projet fonctionne grâce à la super bibliothèque gratuite **[leboncoin-api-search](https://github.com/thomasync/leboncoin-api-search)**

TV Rat utilise cet outil pour se connecter. **Le code est 100% compatible** avec toutes les options de cette bibliothèque. Si vous vous y connaissez, vous pouvez ajouter n'importe quel filtre (mots-clés précis, code postal, vendeur pro/particulier, etc.) dans le fichier de configuration.

## 🛠️ Installation et Lancement

Voici comment installer ce robot sur votre propre ordinateur ou serveur.

### 1. Prérequis
- [Node.js](https://nodejs.org/) (version 18 ou plus récente)
- Un ordinateur ou un serveur (VPS) connecté à internet.

### 2. Récupérer le code
```bash
git clone https://github.com/matpisk07/tv-rat.git
cd tv-rat
```

### 3. Installer les fichiers nécessaires
```bash
npm install
```

### 4. Configuration

Tout se règle au début du fichier `index.js`. Par défaut, le fichier est réglé pour les besoins de notre asso, mais vous pouvez tout changer :

- **PARIS_COORDS** : Changez les chiffres pour mettre la latitude/longitude de votre ville.

- **TARGET_CATEGORIES** : La liste des catégories à surveiller (ex: 15 pour les PC, 16 pour la Vidéo).

- **INTERVAL_MINUTES** : Le temps d'attente entre deux vérifications (par défaut : 60 min).

### 5. Lancement avec pm2

Pour que le robot tourne tout le temps sans s'arrêter (même si vous fermez la fenêtre), utilisez PM2.

```bash
# 1. Installer PM2 et TSX globalement (une seule fois)
sudo npm install -g pm2 tsx

# 2. Démarrer le robot (en utilisant l'interpréteur tsx)
pm2 start index.js --name "tv-rat" --interpreter tsx

# 3. Installer la gestion automatique des logs (évite de saturer le disque)
pm2 install pm2-logrotate

# 4. Sauvegarder (pour qu'il se relance si le serveur redémarre)
pm2 save
pm2 startup
```
L'interface sera accessible sur `http://localhost:3000`.

### 6. Sécurisation

Ce bot fonctionne parfaitement derrière un Reverse Proxy Nginx. Il est fortement recommandé d'utiliser Certbot pour obtenir un certificat SSL gratuit (Let's Encrypt). Cela permet d'avoir le cadenas vert et d'éviter les problèmes d'affichage d'images sécurisées.

## 📜 Licence
Ce projet est libre de droits sous la licence GNU GPLv3. Vous avez le droit de le copier, de le modifier et de le partager, à condition de laisser le code ouvert et gratuit pour les autres.

By Mattia 🐀
