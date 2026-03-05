# PRD - Obsidian Second Brain pour RC1

**Auteur** : RC1
**Date** : 2026-03-04
**Statut** : Draft - En attente validation Rolland
**Contexte** : Analyse de la video de Cole Medin + etat actuel du vault CHATTERS + infrastructure RC1

---

## 1. Probleme

Rolland possede un vault Obsidian CHATTERS de **4 254 notes** (~15 Mo de markdown) reparties ainsi :

| Dossier | Notes | % |
|---------|-------|---|
| 002 - Projets | 2 977 | 70% |
| 005 - Ressource | 500 | 12% |
| 999 - Notes Journalieres | 293 | 7% |
| 000 - INBOX | 153 | 4% |
| FleetingNotesApp | 69 | 2% |
| 006 - PERSONNEL | 42 | 1% |
| Autres | ~220 | 5% |

Aujourd'hui, RC1 peut lire ces notes (Grep/Glob/Read) mais ne les exploite pas de maniere proactive. Les notes ne sont pas indexees semantiquement, et RC1 ne connait pas la structure de contenu du vault au-dela des noms de dossiers.

**Question centrale** : Faut-il mettre en place un vector database / RAG pour que RC1 exploite pleinement ces 4 254 notes comme un vrai "second cerveau" ?

---

## 2. Analyse : Vector DB ou pas ?

### 2.1 Arguments POUR un vector DB (RAG)

- **Recherche semantique** : trouver des notes liees par le sens, pas juste les mots-cles. Ex: "quelles notes parlent de transformation digitale dans la construction" meme si ces mots exacts n'apparaissent pas.
- **Decouverte de connexions** : liens caches entre notes de projets differents.
- **Scalabilite** : si le vault grandit au-dela de 10 000 notes.

### 2.2 Arguments CONTRE (pour l'instant)

- **Volume geralble** : 4 254 notes / 15 Mo = Claude Code peut grep l'integralite en quelques secondes.
- **Overhead d'infra** : vector DB (ChromaDB/Qdrant) + embeddings + pipeline d'indexation + maintenance.
- **Fenetre de contexte** : Claude Code a 1M tokens. 15 Mo de markdown ~ 3.75M tokens. On peut charger ~25% du vault dans un seul prompt. Avec des requetes ciblees (Grep), on couvre 95% des cas.
- **Tendance 2026** : les fenetres de contexte longues rendent le RAG classique moins necessaire pour des volumes < 50 Mo.
- **Complexite** : RAG mal configure = hallucinations sur tes propres donnees. Pire qu'une recherche textuelle qui ne trouve rien.

### 2.3 Verdict

**Phase 1 (maintenant) : PAS de vector DB.** Enrichir l'approche actuelle avec un index intelligent + des skills dedies.

**Phase 2 (si besoin, dans 3-6 mois) : RAG local leger** si la recherche textuelle montre ses limites.

---

## 3. Plan d'implementation - Phase 1 : "Smart Index"

### 3.1 Vault Map (CLAUDE.md enrichi)

Creer un fichier `VAULT-MAP.md` dans le vault qui sert de "table des matieres intelligente" pour RC1. Ce fichier est reference dans le CLAUDE.md du projet ClaudeClaw.

```markdown
# CHATTERS Vault Map

## Structure
- 002 - Projets/ : 2977 notes
  - GS1 Construction/ : [N] notes - Mission conseil 2025-2026
  - AQUATIRIS/ : Notes relation client
  - 360&1/ : Notes entreprise
  - ...
- 005 - Ressource/ : 500 notes
  - 053-YoutubeKnowlegeBase/ : Analyses videos
  - ...
- 999 - Notes Journalieres/ : Daily notes YYYY-MM-DD
- 006 - PERSONNEL/ : Notes privees

## Index thematique
- Innovation BTP : 002-Projets/GS1*, 005-Ressource/...
- Conseil strategie : 002-Projets/360&1*, 006-PERSONNEL/...
- IA & Outils : 005-Ressource/053-*, Clippings/...
- Contacts cles : 003-Personnes/, 004-Entreprises/
```

**Effort** : 2-3h (scan automatique + curation manuelle)
**Impact** : RC1 sait immediatement ou chercher selon le sujet.

### 3.2 Skill "obsidian-search" (recherche intelligente)

Creer un skill dedie a la recherche dans le vault, plus malin qu'un simple Grep :

```
~/.claude/skills/obsidian-search/SKILL.md
```

**Fonctionnalites :**
- Recherche multi-strategie : mots-cles exacts, puis variantes (synonymes courants), puis patterns de nommage Obsidian
- Recherche par tag, par frontmatter, par lien wiki `[[]]`
- Agregation de resultats avec contexte (pas juste les noms de fichiers)
- Genere un digest resume quand il y a beaucoup de resultats
- Connait la VAULT-MAP pour prioriser les dossiers pertinents

**Effort** : 3-4h
**Impact** : RC1 trouve les bonnes notes du premier coup au lieu de grepper a l'aveugle.

### 3.3 Skill "obsidian-digest" (synthese proactive)

Quand Rolland demande "qu'est-ce que j'ai sur [sujet]", RC1 :
1. Cherche les notes pertinentes (via obsidian-search)
2. Lit les plus importantes (top 10-20)
3. Genere un digest structure avec liens vers les notes sources
4. Propose des connexions entre notes qui ne sont pas encore liees

**Effort** : 2-3h
**Impact** : Le vault devient interrogeable comme un vrai second cerveau.

### 3.4 Skill "obsidian-triage" (nettoyage INBOX)

L'INBOX a 153 notes non triees. Ce skill :
1. Lit chaque note de l'INBOX
2. Propose un classement (dossier cible) base sur le contenu
3. Deplace apres validation

**Effort** : 2h
**Impact** : L'INBOX reste propre, les notes sont classees.

### 3.5 Enrichissement du CLAUDE.md ClaudeClaw

Ajouter au CLAUDE.md actuel :

```markdown
## Obsidian Vault CHATTERS - Guide de navigation

- **Quand Rolland demande des infos sur un projet** : chercher dans 002 - Projets/
- **Quand c'est du contenu/reference** : chercher dans 005 - Ressource/
- **Pour les contacts** : 003 - Personnes/ et 004 - Entreprises/
- **Pour le contexte recent** : 999 - Notes Journalieres/ (dernieres 7 notes)
- **Pour les videos analysees** : 005 - Ressource/053-YoutubeKnowlegeBase/2026/
- **Vault Map complet** : lire VAULT-MAP.md a la racine du vault

### Patterns de recherche efficaces
- Notes GS1 : grep "GS1" dans 002-Projets
- Notes recentes : glob "999*/2026-03-*.md"
- Contacts : grep dans 003-Personnes + 004-Entreprises
- Tags : grep "^tags:.*keyword" ou "#keyword"
```

**Effort** : 30 min
**Impact** : RC1 sait naviguer le vault sans tatonnement.

---

## 4. Plan d'implementation - Phase 2 : RAG local (conditionnel)

### Declencheur

Passer en Phase 2 SI :
- Le vault depasse 10 000 notes ou 50 Mo
- Rolland fait regulierement des requetes semantiques complexes (ex: "quelles notes sont liees a l'innovation dans le BTP sans mentionner ce mot")
- La recherche textuelle echoue plus de 20% du temps

### Architecture recommandee

```
[Obsidian Vault] --> [Indexer Python] --> [ChromaDB local]
                                              |
[RC1 / Claude Code] <-- [obsidian-rag skill] -+
```

**Stack :**
- **ChromaDB** : vector DB leger, local, zero config, supporte les embeddings locaux
- **Embeddings** : `nomic-embed-text` via Ollama (local, gratuit, performant)
- **Indexer** : script Python qui scanne le vault, chunk les notes, genere les embeddings, stocke dans ChromaDB
- **Skill obsidian-rag** : remplace obsidian-search, combine recherche textuelle + semantique

**Pourquoi ChromaDB** :
- S'installe en une commande (`pip install chromadb`)
- Fonctionne en local (pas de serveur a maintenir)
- Supporte la persistence sur disque
- API Python simple
- Performant jusqu'a ~100k documents

**Pourquoi PAS Qdrant/Milvus/Pinecone** :
- Qdrant/Milvus = overkill pour < 50k notes
- Pinecone = cloud, tes notes quittent ta machine
- ChromaDB = le bon outil pour le bon volume

**Effort estime** : 1-2 jours
**Prerequis** : Ollama installe sur le Mac Mini (pour les embeddings locaux)

---

## 5. Comparaison avec l'approche Cole Medin

| Aspect | Cole Medin | Toi (Rolland) |
|--------|-----------|---------------|
| Acces au vault | Claude Code direct (fichiers locaux) | RC1 via Google Drive (parfois cloud-only) |
| Skills | 6 skills second-brain | 23 skills (dont GS1, video, etc.) |
| Volume notes | Non precise (semble < 1000) | 4 254 notes |
| MCP | Zapier MCP via skill-wrapper | Google Workspace + GS1 Sheets direct |
| Vector DB | Non (pas mentionne) | Pas necessaire Phase 1 |
| Interface | Terminal VS Code | Telegram via ClaudeClaw |
| Brand system | Oui (generateur de brand) | A faire si utile |

**Ce qu'on peut reprendre de Cole Medin :**
1. Le concept de VAULT-MAP (il utilise ses global rules pour guider Claude)
2. Le pattern "MCP as skill" (on a deja Zapier dispo si besoin)
3. Le skill-creator pour industrialiser la creation de skills

**Ce qui est deja mieux chez toi :**
1. Plus de skills specialises (23 vs 6)
2. Daemon 24/7 (pas besoin d'ouvrir VS Code)
3. Interface Telegram (accessible partout)
4. Memoire SQLite 3 couches (pas juste le contexte session)

---

## 6. Roadmap

### Semaine 1 - Quick wins (Phase 1a)
- [ ] Enrichir le CLAUDE.md avec les patterns de navigation vault (30 min)
- [ ] Generer le VAULT-MAP.md automatiquement (scan + index) (2h)
- [ ] Trier les 153 notes INBOX (skill obsidian-triage) (2h)

### Semaine 2 - Skills vault (Phase 1b)
- [ ] Creer skill obsidian-search (recherche intelligente multi-strategie) (3-4h)
- [ ] Creer skill obsidian-digest (synthese sur un sujet) (2-3h)
- [ ] Tester sur 5-10 requetes types de Rolland

### Semaine 3+ - Observation
- [ ] Utiliser le systeme pendant 2-4 semaines
- [ ] Noter les cas ou la recherche textuelle echoue
- [ ] Decider si Phase 2 (RAG) est necessaire

### Phase 2 (si declenchee)
- [ ] Installer Ollama + nomic-embed-text sur Mac Mini
- [ ] Installer ChromaDB
- [ ] Ecrire l'indexer Python
- [ ] Creer skill obsidian-rag
- [ ] Benchmark vs recherche textuelle

---

## 7. Risques

| Risque | Probabilite | Impact | Mitigation |
|--------|-------------|--------|------------|
| Google Drive "cloud-only" bloque l'acces aux notes | Moyen | Fort | Utiliser Drive MCP en fallback, configurer l'acces offline |
| Sync bi-machine ecrase les corrections de skills | Eleve | Moyen | Versionner les skills avec git, ajouter un .gitignore pour les fichiers de config sensibles |
| RAG Phase 2 genere des hallucinations | Faible | Fort | Toujours combiner RAG + citation des sources, fallback textuel |
| Volume vault explose (imports massifs) | Faible | Moyen | Monitoring taille vault, archivage periodique |

---

## 8. Decision demandee

Rolland, voici ce que je recommande :

1. **Demarrer Phase 1 maintenant** - Pas de vector DB, juste un index intelligent + 3 skills dedies. Effort total : ~1 jour.

2. **Observer pendant 1 mois** - Est-ce que la recherche textuelle enrichie suffit ?

3. **Phase 2 uniquement si necessaire** - Et dans ce cas, ChromaDB + Ollama en local sur le Mac Mini.

**Question** : Tu veux que j'attaque la Phase 1a (enrichir le CLAUDE.md + generer le VAULT-MAP) tout de suite ?
