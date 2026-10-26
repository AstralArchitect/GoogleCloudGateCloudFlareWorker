# Passerelle Cloudflare Worker pour TheMeteo (Google Maps Platform API)

Ce Cloudflare Worker sert de **passerelle sécurisée (Reverse Proxy)** entre l'application Android **TheMeteo** et les API Google Maps Platform (**Air Quality**, **Pollen**, et **Geocoding**).

Il permet de **supprimer complètement la clé API Google Maps de l'APK**, éliminant tout risque d'extraction ou de fuite de clé, tout en ajoutant un cache Edge Cloudflare ultra-rapide pour réduire vos coûts et quotas Google Cloud.

---

## 🎯 Architecture & Fonctionnement

Dans le code source de TheMeteo (`WeatherService.kt`), les appels Google Maps Platform sont :
1. **Google Air Quality - Conditions actuelles** : `POST https://airquality.googleapis.com/v1/currentConditions:lookup`
2. **Google Air Quality - Prévisions** : `POST https://airquality.googleapis.com/v1/forecast:lookup`
3. **Google Geocoding** : `GET https://maps.googleapis.com/maps/api/geocode/json` (recherche du nom de ville d'après coordonnées)
4. **Google Pollen - Prévisions** : `GET https://pollen.googleapis.com/v1/forecast:lookup`

### Comment le Worker résout la sécurité :
- La clé `GOOGLE_MAPS_API_KEY` est stockée **uniquement** dans les secrets chiffrés de Cloudflare (`wrangler secret`).
- L'APK ne contient plus aucune clé pour ces services.
- Le Worker intercepte les requêtes, injecte la clé API secrète côté serveur, puis relaie la réponse.
- **Cache Cloudflare Edge automatique** :
  - Le géocodage inverse est mis en cache (7 jours par défaut) : les requêtes répétées pour la même ville ne consomment plus de quota Google.
  - Le pollen et la qualité de l'air sont mis en cache (1h / 30min).
- **Protection par jeton applicatif (Optionnel)** : Possibilité de définir un secret `APP_TOKEN` sur le Worker que seule votre application envoie via l'en-tête `X-App-Token`.

---

## 🚀 Guide d'installation et déploiement

### 1. Prérequis
- [Node.js](https://nodejs.org/) (v18+)
- Un compte Cloudflare (gratuit)

### 2. Configuration locale
Installez les dépendances :
```bash
npm install
```

Créez un fichier `.dev.vars` pour tester en local (voir `.dev.vars.example`) :
```env
GOOGLE_MAPS_API_KEY=AIzaSy...
```

Lancez le serveur de développement local :
```bash
npm run dev
```

### 3. Déploiement sur Cloudflare
Connectez votre CLI Cloudflare :
```bash
npx wrangler login
```

Configurez votre clé secrète Google Maps (elle sera chiffrée sur Cloudflare) :
```bash
npx wrangler secret put GOOGLE_MAPS_API_KEY
# Saisissez votre clé API Google lorsque l'invite s'affiche
```

*(Optionnel)* Si vous souhaitez restreindre l'accès au Worker avec un jeton d'application :
```bash
npx wrangler secret put APP_TOKEN
```

Déployez le Worker :
```bash
npm run deploy
```

Une fois déployé, Wrangler vous fournira une URL de type :
`https://themeteo-maps-gateway.<votre-compte>.workers.dev`

Testez la santé du service :
```bash
curl https://themeteo-maps-gateway.<votre-compte>.workers.dev/health
```

---
