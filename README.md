# RBFAdata

## Seizoensupdate

De standaardkalender is die van seizoen 2026-2027 (`CHP_136334`). Voer de
volledige update uit met:

```bash
npm run update:data
```

De kalender wordt altijd als eerste opgehaald. De event- en spelersscrapers
bewaren daarna uitsluitend rijen waarvan de wedstrijd-URL in de kalender van
het huidige seizoen voorkomt. Zo kan data van een vorig seizoen niet in het
dashboard achterblijven.

`data_raw/data_team_prev.csv` is de vaste referentie van seizoen 2025-2026 en
wordt niet door de update overschreven. De puntenlijn van dat seizoen blijft
daardoor beschikbaar naast de opnieuw opgebouwde lijn van het huidige seizoen.

Voor een andere competitie kan de kalender tijdelijk worden overschreven:

```bash
RBFA_CALENDAR_URL=https://www.rbfa.be/nl/competitie/CHP_xxxxxx/kalender npm run update:data
```

## Problemen bij het ophalen

De RBFA-pagina maakt de kalender-dropdown asynchroon aan. Het `<select>`-element
kan dus al bestaan terwijl de 52 opties en de wedstrijden nog niet geladen zijn.
De scraper wacht daarom eerst op de gevulde dropdown en gebruikt het
`<select>`-element met de meeste opties. De eerste opties mogen een lege
wedstrijdlijst tonen; de eigenlijke competitie begint momenteel pas bij optie 9.

Een fout van `prod.nessie.fourcast.io` is afkomstig van RBFA-analytics en heeft
geen invloed op de kalendergegevens. Als de volledige scrape toch leeg blijft,
wordt `data_raw/match_calendar.json` niet overschreven. Zo ontstaat in de
Python-verwerking niet langer de misleidende vervolgfout `KeyError: 'date'`.

RBFA's GraphQL-server stuurt momenteel bij headless browsers geen geldige
`Access-Control-Allow-Origin`-header terug. De scrapers starten daarom hun
geïsoleerde Chromium-proces met uitgeschakelde browser-side CORS-controle. Dit
geldt uitsluitend voor het tijdelijke browserproces van de scraper en verandert
geen beveiligingsinstellingen van de gewone browser.
