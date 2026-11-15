# Internationalization audit — Jezero Traverse (RU / EN / KK)

## Scope

The global globe, Jezero map, NASA photo and panorama viewers, landing-site cards, and
scientific region reports use the selected interface language consistently.

### What changed

- `web/scienceRegionTranslations.ts` — scientific display descriptions and
  georeferencing caveats for all 11 catalogued regions.
- `web/scienceSiteTranslations.ts` — landing-site and science-event descriptions,
  uncertainty notes, and NASA image labels for all 11 entries.
- `web/sciencePhotoTranslations.ts` — 15 verified photo/panorama titles,
  captions and position disclaimers in Russian and Kazakh; original NASA captions
  remain as the English option.
- `web/i18nCatalog.ts` — region report headings, telemetry labels, accessibility
  labels and status messages in all three languages.
- The display components use explicit `regionText`, `siteText`, and `photoText`
  selectors instead of directly printing Russian metadata.

The source catalogs, geographic coordinates, original images, NASA links,
DEM/CTX/CRISM/THEMIS data and scientific calculations are **unchanged**.
Original mission and instrument names remain unmodified where appropriate.

## Validation

Run:

```bash
npm ci
npm test
npm run build
```

`web/scienceLocalization.test.ts` checks all 11 regions, 11 landing/science
records, and 15 photo records across RU/EN/KK. It also checks that English
views contain no Cyrillic scientific descriptions, tests preservation of
source-location caveats, and scans science components for hard-coded Russian
JSX and `aria-label` strings.

Check the interface manually in all three languages:
1. Switch to English / Қазақша / Русский and refresh.
2. Rotate the globe and open the regional reports for Gale, Oxia and Jezero.
3. Inspect the region's title, scientific description, source note and telemetry.
4. Open landing-site cards (including Phoenix ice and InSight marsquake).
5. Open Jezero photos and NASA panoramas and verify translated captions,
   location caveats and map markers.
6. Test the flat map, regional map, keyboard navigation and small-screen view.

Source titles from NASA/JPL and scientific identifiers may intentionally
remain in their original form as attributed mission data.

## Limitations

A translated description does not change the underlying georeferencing
accuracy. Photo markers represent rover/lander areas where documented, not
necessarily the locations of objects visible in the frames. The 20 m CTX DEM
cannot certify crew or rover safety.
