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

Als RBFA een foutpagina terugstuurt of de opbouw van de kalenderpagina wijzigt,
stopt de update nu meteen met een duidelijke foutmelding. Een lege scrape wordt
niet meer over `data_raw/match_calendar.json` geschreven. Daardoor blijft de
laatste geldige kalender behouden en verschijnt niet langer pas in de
Python-verwerking de misleidende fout `KeyError: 'date'`.
