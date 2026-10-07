# Campus TgMaster — guide d'installation

Application web de cours en ligne : espace étudiant (cours, quiz à validation unique) et espace
administrateur (création des comptes, résultats des quiz, progression de chaque étudiant).

## Ce qu'il faut sur le serveur

- PHP 7.4 ou plus récent (PHP 8 recommandé), avec les extensions `pdo_sqlite` et `json`.
- Un hébergement web classique suffit (Apache ou nginx). Aucune base MySQL à créer :
  les données sont dans un fichier SQLite créé automatiquement.
- HTTPS activé (obligatoire pour protéger les mots de passe).

## Installation (10 minutes)

1. Copier tout le dossier `campus` sur le serveur, par exemple dans `public_html/campus`.
   L'adresse sera alors `https://votre-domaine/campus/`.
2. Donner au serveur web le droit d'écrire dans le dossier `data` (chmod 775, ou 755 si PHP
   tourne sous votre utilisateur).
3. Ouvrir `https://votre-domaine/campus/admin.html` et créer **immédiatement** le compte
   administrateur (identifiant + mot de passe d'au moins 10 caractères). Cette étape n'est
   possible qu'une fois : la première personne qui ouvre cette page devient administrateur.
4. Dans « Créer des comptes », créer les étudiants un par un ou en lot
   (`matricule;nom;prénoms;classe`, une ligne par étudiant, collable depuis Excel).
   Les mots de passe générés s'affichent une seule fois : copier ou télécharger la liste.
5. Donner aux étudiants l'adresse `https://votre-domaine/campus/` avec leur matricule
   et leur mot de passe.

## Sécurité : à vérifier après l'installation

- `https://votre-domaine/campus/data/` doit afficher « accès refusé » (403).
  Sous **Apache**, les fichiers `.htaccess` fournis s'en chargent.
  Sous **nginx**, ajouter dans la configuration du site :

      location ~ ^/campus/(data|lib)/ { deny all; }

- Les corrigés des quiz (`data/courses.php`) ne sont jamais envoyés au navigateur avant la
  validation : la correction est faite par le serveur.
- Les mots de passe sont stockés sous forme hachée (`password_hash`). Personne, pas même
  l'administrateur, ne peut les relire : en cas d'oubli, générer un nouveau mot de passe
  depuis la fiche de l'étudiant.
- La connexion est bloquée 15 minutes après 8 échecs.

## Fonctionnement

- **Validation unique** : un étudiant ne peut valider chaque quiz qu'une seule fois. Le score
  est enregistré et apparaît aussitôt dans l'espace administrateur (« Résultats des quiz »).
  L'administrateur peut effacer un résultat pour autoriser une nouvelle tentative (fiche de
  l'étudiant, clic sur le score).
- **Seuil de réussite** : 70 % (constante `PASS_MARK` dans `lib/bootstrap.php`).
- **Correction** : affichée à l'étudiant après validation ; elle peut être masquée dans
  « Paramètres » pendant une période d'évaluation.
- **Export** : « Résultats des quiz » > « Exporter en CSV (Excel) ».

## Sauvegarde

Tout est dans le dossier `data` : le fichier `campus-xxxxxxxx.sqlite` (comptes, résultats, notes)
et `config.php`. Sauvegarder ce dossier régulièrement. Pour restaurer, le recopier tel quel.

## Mot de passe administrateur perdu

Il n'y a pas de récupération par e-mail. Le technicien peut supprimer la ligne de la table
`admins` dans le fichier SQLite, puis rouvrir `admin.html` pour recréer le compte.

## Modifier les cours

Le contenu (13 cours, 130 leçons, 2 600 questions) est dans `data/courses.php`, au format JSON.
Ne pas changer l'identifiant (`id`) d'une leçon déjà passée par des étudiants : les résultats
y sont rattachés.

## Contenu du dossier

    index.html        espace étudiant
    admin.html        espace administrateur
    api.php           serveur (connexion, quiz, administration)
    lib/bootstrap.php configuration, base de données, sessions
    assets/           styles et scripts
    data/             cours + base de données (non accessible depuis le web)
