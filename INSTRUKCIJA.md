# 🚀 Eksāmenu Kalendārs — Palaišanas Instrukcija (Railway)

---

## Ko tev vajag pirms sākšanas

1. **GitHub konts** — ja nav, reģistrējies: https://github.com/signup
2. **Railway konts** — reģistrējies ar GitHub: https://railway.com
3. **Git** uz datora — lejupielādē: https://git-scm.com/downloads

---

## 1. SOLIS — Izveido GitHub repozitoriju

1. Atver https://github.com/new
2. Ieraksti nosaukumu: **exam-calendar**
3. Atstāj **Public**
4. Nespied "Add README" — atstāj tukšu
5. Spied **Create repository**

---

## 2. SOLIS — Augšupielādē kodu uz GitHub

Atver **termināli** (Windows: CMD vai PowerShell, Mac: Terminal) un izpildi:

```bash
# Ej uz mapi kur ir exam-app faili (pielāgo ceļu!)
cd ~/Downloads/exam-app

# Inicializē Git
git init
git add .
git commit -m "Eksāmenu kalendārs"

# Savieno ar GitHub (aizstāj TAVS_USERNAME ar savu GitHub lietotājvārdu!)
git remote add origin https://github.com/TAVS_USERNAME/exam-calendar.git
git branch -M main
git push -u origin main
```

⚠️ Ja prasa pieslēgties — ievadi GitHub lietotājvārdu un Personal Access Token
(to var izveidot: GitHub → Settings → Developer settings → Personal access tokens → Generate new token)

---

## 3. SOLIS — Izveido Railway projektu

1. Atver https://railway.com/dashboard
2. Spied **New Project**
3. Izvēlies **Deploy from GitHub repo**
4. Atļauj Railway piekļūt tavam GitHub — spied **Configure GitHub App**
5. Izvēlies savu **exam-calendar** repozitoriju
6. Railway automātiski sāks deploy

---

## 4. SOLIS — Pievieno Volume (lai dati saglabājas!)

⚠️ **Šis ir ĻOTI SVARĪGI** — bez tā dati pazudīs katrā restartā!

1. Railway projektā spied uz savu servisu
2. Atvēr cilni **Volumes**
3. Spied **Add Volume**
4. Mount Path ieraksti: **/data**
5. Spied **Add**

---

## 5. SOLIS — Uzstādi vides mainīgos

1. Railway projektā atvēr cilni **Variables**
2. Pievieno mainīgo:
   - **Name:** `RAILWAY_VOLUME_MOUNT_PATH`
   - **Value:** `/data`
3. Spied **Add**

Railway automātiski pārdeployos.

---

## 6. SOLIS — Iegūsti savu saiti

1. Railway projektā atvēr cilni **Settings**
2. Sadaļā **Networking** → **Public Networking**
3. Spied **Generate Domain**
4. Tu saņemsi saiti, piem.: `exam-calendar-production-abc123.up.railway.app`

---

## ✅ GATAVS!

Tagad vari atvērt savu saiti pārlūkā un sākt lietot!

### Pirmā pieslēgšanās:

- **Lietotājvārds:** `admin`
- **Parole:** `admin123`

### Ko darīt pēc pieslēgšanās:

1. **Izveido grupas** — piem. "12.a klase", "11.b klase"
2. **Pievieno eksāmenus** — klikšķini uz datuma kalendārā
3. **Nosūti saiti skolēniem** — viņi reģistrējas paši
4. **Piešķir skolēnus grupām** — cilnē "Lietotāji" spied "+ Grupa"
5. Skolēni pieslēdzas un redz savus eksāmenus

---

## ⚠️ SVARĪGI — Nomainiet admin paroli!

Pēc pirmās pieslēgšanās ieteicams nomainīt admin paroli.
Pagaidām to var izdarīt izveidojot jaunu admin lietotāju datubāzē.

---

## Projekta struktūra

```
exam-app/
├── server.js          ← Backend (API + datubāze)
├── public/
│   └── index.html     ← Frontend (viss vienā failā)
├── package.json       ← Node.js konfigurācija
├── Procfile           ← Railway palaišanas komanda
└── .gitignore         ← Ignorējamie faili
```

---

## Ja kaut kas nestrādā

| Problēma | Risinājums |
|-----------|-----------|
| Railway rāda "Build failed" | Pārbaudi vai package.json ir pareizs un vai visi faili augšupielādēti |
| Nevar pieslēgties | Pārbaudi vai Volume un RAILWAY_VOLUME_MOUNT_PATH ir uzstādīti |
| Lapa nerādās | Pārbaudi vai Settings → Networking → ir ģenerēts domēns |
| Dati pazūd pēc restarta | Jāpievieno Volume (4. solis) |
| GitHub prasa paroli | Izmanto Personal Access Token, ne paroli |

---

## Bezmaksas limiti Railway

- **Trial plāns:** $5 kredīts katru mēnesi (pietiek šai lietotnei)
- **Hobby plāns:** $5/mēnesī, neierobežots
- Ja lietotne neizmanto resursus, maksa ir minimāla (~$0.50-1/mēnesī)
