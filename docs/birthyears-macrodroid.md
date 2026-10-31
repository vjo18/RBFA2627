# Geboortejaren verzamelen via MacroDroid

De geboortejaren staan los van de wedstrijddata in `data_raw/player_birthyears.csv` met kolommen `ClubRBFA;Naam;Geboortejaar`. Daardoor gaan ze niet verloren bij een nieuwe wedstrijdscrape.

## 1. Clubnamen ophalen
Voer in Codespaces of lokaal uit:

```bash
npm run scrape:clubs
```

De scraper leest wedstrijdlinks uit `data_raw/match_calendar.json`, zoekt club-ID's in de wedstrijdpagina's en probeert de officiële namen van de clubpagina's op te halen. Controleer `data_raw/team_club_mapping.csv` en vul eventuele lege `ClubRBFA`-waarden handmatig aan. Alleen bevestigde namen worden gebruikt voor de export. De clubnaam moet overeenkomen met de clubnaam in de RBFA-spelerszoekresultaten; controleer verschillen in hoofdletters/afkortingen.

## 2. MacroDroid-export downloaden
Ga naar GitHub → **Actions** → **MacroDroid geboortejaren** → **Run workflow**. Na voltooiing staat de nieuwste export op:

`data_raw/macrodroid_missing_birthyears.csv`

Download via **Raw → Download**. Dit is UTF-8, puntkomma-gescheiden, zonder quotes en met precies de kolommen:

```csv
Ploeg;Naam
K.V.C. Ardooie;Brent Callewaert
```

Elke combinatie van club en speler staat maximaal één keer in de export. Spelers zonder clubkoppeling worden **niet** geëxporteerd; de actie vermeldt ontbrekende koppelingen in het log.

## 3. Resultaten van MacroDroid terugsturen
MacroDroid schrijft een UTF-8 CSV met:

```csv
Ploeg;Naam;Geboortejaar;Gevonden
K.V.C. Ardooie;Brent Callewaert;2001;true
```

Upload het CSV-bestand **zonder hernoemen** naar de map **`data_raw/macrodroid_uploads/`** op GitHub (open de map → **Add file → Upload files** → **Commit changes**). De oorspronkelijke bestandsnaam mag behouden blijven, bijvoorbeeld `resultaten_2026-11-01.csv`. De GitHub Action start automatisch, importeert alle CSV-bestanden in die map in `player_birthyears.csv` en vernieuwt de ontbrekende export. Bestaande bestanden blijven staan; herhaald verwerken voegt geen duplicaten toe. Gebruik voor een nieuwe upload bij voorkeur een nieuwe bestandsnaam, zodat je eerdere resultaten kunt terugvinden.

Ook lokaal mogelijk:

```bash
python processing/birthyears.py import --file /pad/naar/macrodroid_resultaten.csv
python processing/birthyears.py export
```

Resultaten met `Gevonden=false`, ontbrekend/ongeldig geboortejaar of onbekende club-spelercombinatie worden overgeslagen. Bestaande geboortejaren worden nooit stilzwijgend overschreven: afwijkende jaren worden als conflict gemeld. Herhaald uploaden van hetzelfde bestand veroorzaakt geen duplicaten.

## Leeftijd
Met enkel een geboortejaar kun je `huidig kalenderjaar - geboortejaar` berekenen. Dat is geen exacte leeftijd zolang dag en maand onbekend zijn.

## Belangrijk
De clubscraper is nieuw en moet nog worden getest op de live RBFA-pagina's. Controleer de mapping vóór je de eerste grote export naar MacroDroid stuurt.
