# Températures des halls – version Firebase

Même appli que la version actuelle, avec les relevés dans **Firebase** (projet `equipe-batiment`, le même que l'appli Équipe) au lieu du Google Sheet :
affichage en direct (un relevé saisi par un technicien apparaît tout seul chez les autres), consultation et saisie hors connexion.

Adresse : https://eurexpobatiment.github.io/temp/v2/ — l'ancienne version (https://eurexpobatiment.github.io/temp/) reste en service pendant la transition.

Pour les techniciens Dalkia, rien ne change : pas de compte, le même **code de saisie**.
La première saisie du code sur un appareil demande internet ; ensuite les relevés passent même sans réseau.

## Mise en route (une seule fois)
1. **Console Firebase › equipe-batiment › Authentication › Mode de connexion** : activer **Anonyme**.
2. **Firestore Database › Règles** : coller le bloc de `firestore-temperatures.rules` juste avant les deux dernières `}`, puis **Publier**.
3. **Firestore Database › Données** : créer la collection **TempSecret**, document **code**, champ **code** (chaîne) = le code de saisie de l'onglet Réglages du classeur des températures.
4. **Script Google de l'appli températures** : ajouter le fichier `Firebase.gs`, puis exécuter `copierVersFirebase` (copie de tous les relevés, de la plage de confort et des points) et `installerFirebase` (météo et copie des relevés de l'ancienne version, toutes les 10 minutes).
5. **Script Google de l'appli Consommations** : renommer `readTemp_` en `readTempSheet_` (et lui faire renvoyer l'`id` de chaque ligne), ajouter `conso-TemperaturesFirebase.gs`, puis Déployer › Gérer les déploiements › Nouvelle version.

## Fonctionnement
- **Relevés** : collection `TempReleves` (un document par relevé). Lecture libre, comme l'appli actuelle.
- **Code de saisie** : vérifié par les règles Firestore. Chaque appareil se connecte en anonyme et donne le code une fois (`TempSessions`). Changer le code dans `TempSecret/code` bloque aussitôt les anciens appareils, qui devront ressaisir le nouveau code. Pensez aussi à le changer dans l'onglet Réglages du classeur (le script l'utilise).
- **Météo** (T ext. Bron, DJU veille) : toujours calculée par le script Google, ajoutée aux relevés dans les 10 minutes.
- **Plan** : image toujours servie par le script Google, puis gardée sur l'appareil.
- **Appli Consommations** : lit les relevés dans Firebase, et dans le classeur pendant la transition (sans doublon).
- **Pendant la transition** : les relevés saisis dans l'ancienne version sont copiés dans Firebase toutes les 10 minutes. L'inverse ne se fait pas : l'ancienne version ne voit pas les relevés saisis dans la nouvelle.
