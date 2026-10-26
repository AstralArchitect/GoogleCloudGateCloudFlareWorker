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

## 📱 Modifications à apporter dans TheMeteo (`WeatherService.kt`)

Dans `fr.matthstudio.themeteo.WeatherService.kt` :

### 1. Déclarer l'URL du Worker
```kotlin
// URL de votre passerelle Cloudflare
private const val MAPS_GATEWAY_URL = "https://themeteo-maps-gateway.<votre-compte>.workers.dev"
```

### 2. Adapter `getAirQuality`
Remplacer :
```kotlin
val url = "https://airquality.googleapis.com/v1/currentConditions:lookup"
...
val response = client.post(url) {
    parameter("key", BuildConfig.MAPS_API_KEY)
    header("X-Android-Package", packageName)
    header("X-Android-Cert", sha1)
    setBody(...)
}
```
Par :
```kotlin
val url = "$MAPS_GATEWAY_URL/airquality/v1/currentConditions:lookup"
...
val response = client.post(url) {
    // Plus besoin de BuildConfig.MAPS_API_KEY !
    // (Optionnel si APP_TOKEN configuré sur le worker) :
    // header("X-App-Token", "votre_token")
    setBody(...)
}
```

### 3. Adapter `getAirQualityForecast`
Remplacer :
```kotlin
val url = "https://airquality.googleapis.com/v1/forecast:lookup"
...
val response = client.post(url) {
    parameter("key", BuildConfig.MAPS_API_KEY)
    ...
```
Par :
```kotlin
val url = "$MAPS_GATEWAY_URL/airquality/v1/forecast:lookup"
...
val response = client.post(url) {
    // Plus besoin de clé API !
    setBody(...)
```

### 4. Adapter `getCityNameFromCoords` (Géocodage inverse)
Remplacer :
```kotlin
val url = "https://maps.googleapis.com/maps/api/geocode/json"
...
val response = client.get(url) {
    parameter("latlng", "$latitude,$longitude")
    parameter("key", BuildConfig.MAPS_API_KEY)
    parameter("language", java.util.Locale.getDefault().language)
    parameter("result_type", "locality|sublocality|administrative_area_level_1|administrative_area_level_2")
    header("X-Android-Package", context.packageName)
    header("X-Android-Cert", sha1)
}
```
Par :
```kotlin
val url = "$MAPS_GATEWAY_URL/maps/api/geocode/json"
...
val response = client.get(url) {
    parameter("latlng", "$latitude,$longitude")
    // Plus besoin de paramètre "key" !
    parameter("language", java.util.Locale.getDefault().language)
    parameter("result_type", "locality|sublocality|administrative_area_level_1|administrative_area_level_2")
}
```

### 5. Adapter `getPollenForecast`
Remplacer :
```kotlin
val url = "https://pollen.googleapis.com/v1/forecast:lookup"
...
val response = client.get(url) {
    parameter("key", BuildConfig.MAPS_API_KEY)
    parameter("location.latitude", latitude)
    ...
```
Par :
```kotlin
val url = "$MAPS_GATEWAY_URL/pollen/v1/forecast:lookup"
...
val response = client.get(url) {
    // Plus besoin de clé API !
    parameter("location.latitude", latitude)
    parameter("location.longitude", longitude)
    parameter("days", 3)
    parameter("languageCode", java.util.Locale.getDefault().language)
    parameter("plantsDescription", "true")
}
```

---

## 🗺️ Note importante : La vue carte `MapPickerScreen`

Dans `TheMeteo`, Google Maps est également utilisé pour afficher une carte interactive de sélection de lieu (`GoogleMap` dans `MapPickerScreen` via `play-services-maps`).

- Le SDK Google Maps natif Android (`GoogleMap`) ne passe pas par des requêtes HTTP personnalisables : il communique directement avec les serveurs de tuiles Google via les Google Play Services et nécessite `com.google.android.geo.API_KEY` dans le `AndroidManifest.xml`.
- **Cependant** :
  1. Si vous souhaitez une **version FOSS** sans aucune dépendance Google ni clé, vous pouvez remplacer `GoogleMap` dans `MapPickerScreen` par **`Osmdroid`** (OpenStreetMap), qui est **déjà intégré** dans TheMeteo (`libs.osmdroid.android`) pour la vue satellite météo !
  2. Si vous conservez `GoogleMap`, restreignez cette clé dans la console Google Cloud **strictement au SDK Google Maps Android** (Maps SDK for Android). Comme les API REST (Geocoding, Air Quality, Pollen) passent désormais par le Worker, cette clé ne permettra aucun abus des API de données payantes.

