"""Safely integrate Task #15 into existing profile_mars.py (run from repo root).

Only changes the current export path. It creates a backup and refuses to
modify unexpected versions, so concurrent team edits are not overwritten.
"""
from __future__ import annotations

from pathlib import Path
import sys

TARGET = Path(__file__).resolve().parent / "profile_mars.py"
IMPORT_ANCHOR = "from route_metrics import calculate_route_metrics\n"
IMPORT_REPLACEMENT = IMPORT_ANCHOR + "from route_export import write_profile_csv, save_elevation_png\n"
ORIGINAL_CSV = '''        with (output / "route_profile.csv").open("w", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            writer.writerow(["distance_m", "elevation_m", "x_projected", "y_projected", "latitude_n", "longitude_e", "dem_status"])
            for d, z, xy, la, lo, state in zip(profile.distance_m, profile.elevation_m,
                                                profile.xy, lat, lon, profile.sample_status):
                writer.writerow([f"{d:.3f}", f"{z:.3f}" if np.isfinite(z) else "",
                                 f"{xy[0]:.3f}", f"{xy[1]:.3f}", f"{la:.8f}", f"{lo:.8f}", str(state)])
'''
NEW_CSV = '''        write_profile_csv(output / "route_profile.csv", profile,
                          latitude_n=lat, longitude_e=lon,
                          interval_slope_deg=risks.interval_slope_deg)
'''
PNG_ANCHOR = '        self.fig.savefig(output / "route_profile.png", dpi=170, facecolor=self.fig.get_facecolor())\n'
PNG_REPLACEMENT = PNG_ANCHOR + '        save_elevation_png(output / "elevation_profile.png", profile, risks.interval_slope_deg)\n'
PRINT_ANCHOR = '        print(f"Dashboard: {output / \'route_profile.png\'}")\n'
PRINT_REPLACEMENT = PRINT_ANCHOR + '        print(f"Elevation profile: {output / \'elevation_profile.png\'}")\n'


def patch_text(original: str) -> str:
    if "from route_export import write_profile_csv" in original:
        raise ValueError("Task 15 is already integrated; refusing to apply it twice")
    substitutions = (
        (IMPORT_ANCHOR, IMPORT_REPLACEMENT),
        (ORIGINAL_CSV, NEW_CSV),
        (PNG_ANCHOR, PNG_REPLACEMENT),
        (PRINT_ANCHOR, PRINT_REPLACEMENT),
    )
    for old, _new in substitutions:
        if original.count(old) != 1:
            raise ValueError("The local profile_mars.py differs from the expected revision. "
                             "No changes made. Missing or duplicated anchor:\n" + old[:145])
    text = original
    for old, new in substitutions:
        text = text.replace(old, new, 1)
    compile(text, str(TARGET), "exec")
    return text


def main() -> int:
    if not TARGET.is_file():
        print(f"Cannot find {TARGET}. Place apply_task15.py in project root.", file=sys.stderr)
        return 2
    try:
        before = TARGET.read_text(encoding="utf-8")
        after = patch_text(before)
    except ValueError as exc:
        print(f"NO CHANGES: {exc}", file=sys.stderr)
        return 2
    backup = TARGET.with_suffix(".py.task15_backup")
    if backup.exists():
        print(f"NO CHANGES: backup already exists: {backup}", file=sys.stderr)
        return 2
    backup.write_text(before, encoding="utf-8")
    TARGET.write_text(after, encoding="utf-8")
    print("Task 15 integration complete:", TARGET)
    print("Backup:", backup)
    print("New CSV column: measured_slope_deg")
    print("New PNG: elevation_profile.png; existing route_profile.png kept")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
