# Jezero Traverse

NASA Space Apps Challenge prototype for studying terrain along a proposed Mars exploration route in the Jezero crater.

## Existing module

- **profile_mars.py** — the original interactive two-point DEM elevation-profile script, preserved from main.
- **requirements.txt** — the original script dependencies.

## Site selection module (this branch)

- **jezero_site_selection/** — documented Three Forks → Wildcat Ridge study site, Mars-specific coordinates and DEM coverage verification.
- See [site selection README](jezero_site_selection/README.md) for setup, download link and scientific limitations.

The USGS Mars DEM is distributed separately and intentionally excluded from Git. No astronaut-safe route is claimed. Next milestone: slope analysis and comparison of a straight versus a waypoint route.
