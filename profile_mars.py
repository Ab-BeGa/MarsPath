"""Jezero Traverse · interactive Mars waypoint route planner.

Run from repository root:
    python profile_mars.py --dem jezero_site_selection/M20_JezeroCrater_CTXDEM_20m.tif

Left-click empty terrain: insert intermediate waypoint at nearest route segment.
Drag an intermediate waypoint: move it. Right-click a waypoint: delete it.
Ctrl+Z: undo; R: reset; E: export CSV, JSON and PNG.

Renders actual USGS elevations, not simulated terrain. This is a planning
prototype, NOT a validated astronaut-safe traverse or obstacle detector.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path

import matplotlib
import matplotlib.pyplot as plt
import numpy as np
import rasterio
from matplotlib.colors import LinearSegmentedColormap, LightSource
from matplotlib.collections import LineCollection
from matplotlib.lines import Line2D
from matplotlib.ticker import FuncFormatter
from matplotlib.widgets import Button, TextBox
from pyproj import CRS, Transformer
from rasterio.windows import from_bounds, bounds as window_bounds

from route_geometry import (nearest_segment_index, route_samples,
                            profile_index_at_distance, route_index_near_xy)
from route_metrics import calculate_route_metrics
from route_export import write_profile_csv, save_elevation_png
from traversability import SlopeThresholds, analyze_traversability
from detour_planner import plan_detour, NoDetourError
from terrain_sampling import sample_dem_points

ROOT = Path(__file__).resolve().parent
SITE = ROOT / "jezero_site_selection"
DEMFILENAME = "M20_JezeroCrater_CTXDEM_20m.tif"
BG = "#07121e"
PANEL = "#102031"
BORDER = "#253b4c"
TEXT = "#eaf5fa"
MUTED = "#91a7b8"
TEAL = "#55efc4"
GOLD = "#ffce78"
BAD = "#ff8e7c"
SLOPE_COLORS = {"gentle": "#55efc4", "moderate": "#fcd16b",
                "steep": "#ff9e61", "very_steep": "#ff5279",
                "unknown": "#b6c1cd"}

MARS_COLORS = LinearSegmentedColormap.from_list(
    "mars-terrain", ["#251b22", "#4f3032", "#855044", "#ae7856", "#d6a573", "#efd8ab"], 256
)


def locate_dem(explicit: str | None) -> Path:
    if explicit:
        return Path(explicit).expanduser().resolve()
    candidates = [ROOT / "data" / DEMFILENAME, SITE / DEMFILENAME, ROOT / DEMFILENAME, Path.cwd() / DEMFILENAME]
    for path in candidates:
        if path.exists():
            return path
    raise SystemExit("DEM not found. Place the USGS .tif in data/ or jezero_site_selection/ or pass --dem PATH.\n"
                     "Source: https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/" + DEMFILENAME)


class Terrain:
    def __init__(self, dem_path: Path, config_path: Path):
        self.dem_path = dem_path
        self._dem_sha256: str | None = None
        self.config = json.loads(config_path.read_text(encoding="utf-8"))
        self.dem = rasterio.open(dem_path)
        if self.dem.crs is None or not self.dem.crs.is_projected:
            self.dem.close()
            raise ValueError("Mars-projected raster DEM required")
        self.crs = CRS.from_wkt(self.dem.crs.to_wkt())
        if not self.crs.geodetic_crs:
            self.dem.close()
            raise ValueError("Mars geodetic CRS missing from DEM")
        self.from_lonlat = Transformer.from_crs(self.crs.geodetic_crs, self.crs, always_xy=True)
        self.to_lonlat = Transformer.from_crs(self.crs, self.crs.geodetic_crs, always_xy=True)
        _, self.meters_per_unit = self.dem.crs.linear_units_factor
        if not self.meters_per_unit:
            self.dem.close()
            raise ValueError("DEM horizontal units not defined")
        self.meters_per_unit = float(self.meters_per_unit)
        bbox = self.config["extent_planetocentric"]
        lon = [bbox["west_longitude_e"], bbox["east_longitude_e"]]
        lat = [bbox["south_latitude_n"], bbox["north_latitude_n"]]
        corners = [self.from_lonlat.transform(lo, la) for lo in lon for la in lat]
        x, y = np.asarray(corners).T
        self.xy_bounds = (float(x.min()), float(x.max()), float(y.min()), float(y.max()))
        left, right, bottom, top = self.xy_bounds
        win = from_bounds(left, bottom, right, top, transform=self.dem.transform)
        self.window = win.round_offsets().round_lengths()
        if (self.window.width < 2 or self.window.height < 2
            or self.window.col_off < 0 or self.window.row_off < 0
            or self.window.col_off + self.window.width > self.dem.width
            or self.window.row_off + self.window.height > self.dem.height):
            self.dem.close()
            raise ValueError("Study region is outside the DEM bounds")
        self.grid = self.dem.read(1, window=self.window, masked=True).astype(float)
        self.map_bounds = window_bounds(self.window, self.dem.transform)
        self.has_data = np.isfinite(self.grid.filled(np.nan))
        if not np.any(self.has_data):
            self.dem.close()
            raise ValueError("No valid elevation inside selected study region")
        self.fixed_points = np.asarray([
            self.from_lonlat.transform(p["longitude_e"], p["latitude_n"])
            for p in self.config["points"]
        ], dtype=float)
        if len(self.fixed_points) != 2:
            self.dem.close()
            raise ValueError("Two base/science fixed points required")
        for p in self.fixed_points:
            if not self.is_valid(p):
                self.dem.close()
                raise ValueError("Base or science point outside valid DEM pixels")

    def close(self):
        self.dem.close()

    def dem_sha256(self) -> str:
        if self._dem_sha256 is None:
            digest = hashlib.sha256()
            with self.dem_path.open("rb") as source:
                for block in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(block)
            self._dem_sha256 = digest.hexdigest()
        return self._dem_sha256

    def is_valid(self, p) -> bool:
        x, y = p
        l, r, b, t = self.xy_bounds
        if not (l <= x <= r and b <= y <= t):
            return False
        row, col = self.dem.index(x, y)
        ro, co = int(row - self.window.row_off), int(col - self.window.col_off)
        return 0 <= ro < self.grid.shape[0] and 0 <= co < self.grid.shape[1] and bool(self.has_data[ro, co])

    def sample_with_status(self, xy) -> tuple[np.ndarray, np.ndarray]:
        """Sample the source GeoTIFF and classify missing values explicitly."""
        return sample_dem_points(self.dem, xy, self.xy_bounds)

    def sample(self, xy) -> np.ndarray:
        """Legacy elevation-only helper retained for existing consumers."""
        return self.sample_with_status(xy)[0]


class RouteEditor:
    def __init__(self, terrain: Terrain, *, step_m: float = 20.0, output: Path = ROOT,
                 thresholds: SlopeThresholds | None = None):
        self.terrain = terrain
        self.step_m = step_m
        self.output = output
        self.thresholds = thresholds or SlopeThresholds()
        self.detour_plan = None
        self.detour_reference = None
        self.detour_penalty = 12.0
        self.detour_max_grade = None
        self.waypoints = terrain.fixed_points.copy()
        self.history = []
        self.dragging = None
        self.probe_index = None
        self.probe_pinned = False
        self.last_message = "LEFT CLICK TO ADD A WAYPOINT"
        self._build_layout()
        self._connect()
        self.refresh()

    def _build_layout(self):
        plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10})
        self.fig = plt.figure(figsize=(16, 9), facecolor=BG)
        try:
            self.fig.canvas.manager.set_window_title("JEZERO TRAVERSE // Mission Planning")
        except (AttributeError, NotImplementedError):
            pass
        self.fig.text(.035, .957, "JEZERO", color=TEAL, fontsize=21, fontweight="bold")
        self.fig.text(.128, .960, "/ TRAVERSE", color=TEXT, fontsize=18, fontweight="bold")
        self.fig.text(.035, .928, "MARS SURFACE EXPLORATION  /  WESTERN DELTA", color=MUTED, fontsize=9)
        self.fig.text(.948, .958, "MISSION • 01", ha="right", color=GOLD, fontsize=11, fontweight="bold")
        self.map_ax = self.fig.add_axes([.04, .335, .71, .555], facecolor=PANEL)
        self.chart_ax = self.fig.add_axes([.065, .087, .657, .18], facecolor=PANEL)
        self.sidebar = self.fig.add_axes([.777, .084, .19, .806], facecolor=PANEL)
        self.sidebar.set_xlim(0, 1)
        self.sidebar.set_ylim(0, 1)
        self.sidebar.set_xticks([])
        self.sidebar.set_yticks([])
        for spine in self.sidebar.spines.values():
            spine.set_color(BORDER)
        self.sidebar.text(.10, .949, "ROUTE CONTROL", color=TEXT, fontsize=14, fontweight="bold")
        self.sidebar.text(.10, .912, "THREE FORKS → WILDCAT RIDGE", color=MUTED, fontsize=8.5)
        self.metric_length = self.sidebar.text(.10, .825, "—", color=TEAL, fontsize=25, fontweight="bold")
        self.sidebar.text(.10, .785, "PATH DISTANCE", color=MUTED, fontsize=8)
        self.metric_points = self.sidebar.text(.10, .710, "—", color=TEXT, fontsize=19, fontweight="bold")
        self.sidebar.text(.10, .678, "ROUTE NODES", color=MUTED, fontsize=7.5)
        self.metric_coverage = self.sidebar.text(.55, .710, "—", color=TEAL, fontsize=19, fontweight="bold")
        self.sidebar.text(.55, .678, "DEM VALID", color=MUTED, fontsize=7.5)
        self.sidebar.plot([.08, .92], [.647, .647], color=BORDER, lw=1)
        self.metric_ascent = self.sidebar.text(.10, .590, "—", color=TEAL, fontsize=17, fontweight="bold")
        self.sidebar.text(.10, .557, "ASCENT  /  m", color=MUTED, fontsize=7.5)
        self.metric_descent = self.sidebar.text(.55, .590, "—", color=GOLD, fontsize=17, fontweight="bold")
        self.sidebar.text(.55, .557, "DESCENT  /  m", color=MUTED, fontsize=7.5)
        self.metric_net = self.sidebar.text(.10, .479, "—", color=TEXT, fontsize=17, fontweight="bold")
        self.sidebar.text(.10, .447, "NET CHANGE  /  m", color=MUTED, fontsize=7.5)
        self.metric_slope = self.sidebar.text(.55, .479, "—", color=BAD, fontsize=17, fontweight="bold")
        self.sidebar.text(.55, .447, "MAX MEAS. SLOPE", color=MUTED, fontsize=7.1)
        self.metric_warning = self.sidebar.text(.10, .407, "20m DEM  /  SAMPLE-BASED", color=MUTED, fontsize=7.1)
        self.sidebar.plot([.08, .92], [.392, .392], color=BORDER, lw=1)
        self.sidebar.text(.10, .373, "TEST SLOPE LIMITS / DEGREES", color=GOLD, fontsize=7.6)
        self.sidebar.text(.10, .102, "LIVE ELEVATION PROBE", color=GOLD, fontsize=8, fontweight="bold")
        self.probe_info = self.sidebar.text(.10, .080, "HOVER OVER THE PROFILE", color=TEXT, fontsize=9, fontweight="bold")
        self.probe_detail = self.sidebar.text(.10, .060, "CLICK PROFILE TO PIN", color=MUTED, fontsize=7.5)
        self.sidebar.text(.1, .039, "DEMONSTRATION ONLY", color=BAD, fontsize=8.5, fontweight="bold")
        self.sidebar.text(.1, .016, "Not a validated safe route", color=MUTED, fontsize=7.5)

        self.buttons = []
        for label, rect, callback, color in [
            ("UNDO", [.796, .285, .073, .038], self.undo, BORDER),
            ("RESET", [.878, .285, .073, .038], self.reset, BORDER),
            ("EXPORT ROUTE", [.796, .225, .155, .049], self.export, "#17685c"),
            ("AUTO DETOUR (A*)", [.796, .184, .155, .035], self.auto_detour, "#28495c"),
        ]:
            ax = self.fig.add_axes(rect, facecolor=color)
            button = Button(ax, label, color=color, hovercolor="#265e65")
            button.label.set_color(TEXT)
            button.label.set_fontsize(9)
            button.on_clicked(callback)
            self.buttons.append(button)
        self.threshold_fields = []
        for j, val in enumerate((self.thresholds.gentle_max_deg,
                                 self.thresholds.moderate_max_deg,
                                 self.thresholds.steep_max_deg)):
            field_ax = self.fig.add_axes([.797 + .056 * j, .339, .046, .028], facecolor="#223749")
            field = TextBox(field_ax, "", initial=f"{val:g}", color="#223749", hovercolor="#30546b")
            field.text_disp.set_color(TEXT)
            field.text_disp.set_fontsize(10)
            field.on_submit(self._on_threshold_submit)
            self.threshold_fields.append(field)
        self.status_text = self.fig.text(.037, .035, "", color=MUTED, fontsize=8.6)
        self.fig.text(.73, .035, "USGS CTX DEM  •  20m raster  |  elevation samples ~20m apart",
                      color=MUTED, fontsize=8, ha="right")

    def _connect(self):
        self.fig.canvas.mpl_connect("button_press_event", self.on_press)
        self.fig.canvas.mpl_connect("motion_notify_event", self.on_move)
        self.fig.canvas.mpl_connect("button_release_event", self.on_release)
        self.fig.canvas.mpl_connect("key_press_event", self.on_key)
        self.fig.canvas.mpl_connect("axes_leave_event", self.on_axes_leave)

    def _point_tolerance(self) -> float:
        x0, x1 = self.map_ax.get_xlim()
        return abs(x1 - x0) * .025

    def _nearest_waypoint(self, xy) -> int | None:
        distances = np.linalg.norm(self.waypoints - np.asarray(xy), axis=1)
        index = int(np.argmin(distances))
        if distances[index] <= self._point_tolerance():
            return index
        return None

    def on_press(self, event):
        if event.inaxes == self.chart_ax and event.button == 1 and event.xdata is not None:
            idx = profile_index_at_distance(self.profile, event.xdata)
            if idx is not None:
                # A second click on the selected sample releases the pin.
                self.probe_pinned = not (self.probe_pinned and self.probe_index == idx)
                self._set_probe(idx if self.probe_pinned else None)
            return
        if event.inaxes != self.map_ax or event.xdata is None or event.ydata is None:
            return
        xy = np.array([event.xdata, event.ydata], dtype=float)
        if event.button == 3:
            index = self._nearest_waypoint(xy)
            if index is not None and 0 < index < len(self.waypoints) - 1:
                self.history.append(self.waypoints.copy())
                self.detour_plan = None
                self.detour_reference = None
                self.waypoints = np.delete(self.waypoints, index, axis=0)
                self.last_message = f"WAYPOINT {index} REMOVED"
                self.refresh()
            return
        if event.button != 1:
            return
        index = self._nearest_waypoint(xy)
        if index is not None:
            if 0 < index < len(self.waypoints) - 1:
                self.history.append(self.waypoints.copy())
                self.detour_plan = None
                self.detour_reference = None
                self.dragging = index
            return
        if not self.terrain.is_valid(xy):
            self.last_message = "OUTSIDE VALID DEM  /  POINT REJECTED"
            self.refresh()
            return
        if np.min(np.linalg.norm(self.waypoints - xy, axis=1)) < 1e-7:
            return
        index = nearest_segment_index(xy, self.waypoints)
        self.history.append(self.waypoints.copy())
        self.detour_plan = None
        self.detour_reference = None
        self.waypoints = np.insert(self.waypoints, index + 1, xy, axis=0)
        self.last_message = f"WAYPOINT {index + 1} ADDED"
        self.refresh()

    def on_move(self, event):
        if self.dragging is None:
            if self.probe_pinned:
                return
            if event.inaxes == self.chart_ax and event.xdata is not None:
                self._set_probe(profile_index_at_distance(self.profile, float(event.xdata)))
            elif event.inaxes == self.map_ax and event.xdata is not None and event.ydata is not None:
                # Select nearby *route* samples only, not arbitrary nearby terrain.
                display_width = max(float(self.map_ax.bbox.width), 1.0)
                tolerance = (self.map_ax.get_xlim()[1] - self.map_ax.get_xlim()[0]) * 16.0 / display_width
                idx = route_index_near_xy(self.profile, (event.xdata, event.ydata), tolerance)
                self._set_probe(idx)
            else:
                self._set_probe(None)
            return
        if event.inaxes != self.map_ax or event.xdata is None or event.ydata is None:
            return
        xy = np.array([event.xdata, event.ydata], dtype=float)
        if not self.terrain.is_valid(xy):
            return
        neighbors = np.delete(self.waypoints, self.dragging, axis=0)
        if np.min(np.linalg.norm(neighbors - xy, axis=1)) < 1e-7:
            return
        self.waypoints[self.dragging] = xy
        self.detour_plan = None
        self.detour_reference = None
        self.last_message = f"MOVING WAYPOINT {self.dragging}"
        self.refresh()

    def on_axes_leave(self, event):
        if not self.probe_pinned and self.dragging is None:
            self._set_probe(None)

    def on_release(self, event):
        if self.dragging is not None:
            self.dragging = None
            self.last_message = "ROUTE UPDATED"
            self.refresh()

    def on_key(self, event):
        key = (event.key or "").lower()
        if key in {"ctrl+z", "cmd+z"}:
            self.undo()
        elif key == "r":
            self.reset()
        elif key == "e":
            self.export()
        elif key == "backspace" and len(self.waypoints) > 2:
            self.history.append(self.waypoints.copy())
            self.waypoints = np.delete(self.waypoints, -2, axis=0)
            self.detour_plan = None
            self.detour_reference = None
            self.last_message = "LAST INTERMEDIATE POINT REMOVED"
            self.refresh()

    def undo(self, _event=None):
        if self.history:
            self.waypoints = self.history.pop()
            self.dragging = None
            self.detour_plan = None
            self.detour_reference = None
            self.last_message = "UNDO COMPLETE"
            self.refresh()
        else:
            self.last_message = "NOTHING TO UNDO"
            self.refresh()

    def reset(self, _event=None):
        if len(self.waypoints) > 2:
            self.history.append(self.waypoints.copy())
        self.waypoints = self.terrain.fixed_points.copy()
        self.detour_plan = None
        self.detour_reference = None
        self.dragging = None
        self.last_message = "RESET TO DIRECT LINE"
        self.refresh()

    def auto_detour(self, _event=None):
        """A* candidate over real DEM cells; never equate slope cost to safety."""
        try:
            t = self.terrain
            detour = plan_detour(
                t.grid, t.dem.window_transform(t.window),
                t.fixed_points[0], t.fixed_points[1],
                valid_mask=t.has_data, roi_bounds=t.xy_bounds,
                meters_per_unit=t.meters_per_unit,
                penalty_weight=self.detour_penalty,
                max_slope_deg=self.detour_max_grade,
            )
            candidate = route_samples(detour.waypoints_xy, t.sample_with_status,
                                      meters_per_unit=t.meters_per_unit, step_m=self.step_m)
            if candidate.missing_count:
                raise NoDetourError(f"{candidate.missing_count} missing DEM samples along candidate route")
            direct = route_samples(t.fixed_points, t.sample_with_status,
                                   meters_per_unit=t.meters_per_unit, step_m=self.step_m)
        except (NoDetourError, ValueError) as exc:
            self.last_message = "AUTO DETOUR FAILED: " + str(exc)
            self.status_text.set_text("●  " + self.last_message)
            self.status_text.set_color(BAD)
            self.fig.canvas.draw_idle()
            print(self.last_message)
            return False
        self.history.append(self.waypoints.copy())
        self.waypoints = detour.waypoints_xy.copy()
        self.detour_plan = detour
        self.detour_reference = direct
        self.last_message = (f"A* DETOUR: {candidate.total_m:.0f}m   /   "
                             f"DIRECT: {direct.total_m:.0f}m   /   NOT SAFETY-VALIDATED")
        self.refresh()
        print(self.last_message)
        return True

    def calculate(self):
        return route_samples(self.waypoints, self.terrain.sample_with_status,
                             meters_per_unit=self.terrain.meters_per_unit,
                             step_m=self.step_m)

    def refresh(self):
        profile = self.calculate()
        self.profile = profile
        stats = calculate_route_metrics(profile)
        self.route_metrics = stats
        self.traversability = analyze_traversability(profile, self.thresholds)
        ax = self.map_ax
        ax.clear()
        ax.set_facecolor(PANEL)
        arr = self.terrain.grid.filled(np.nan)
        x0, y0, x1, y1 = self.terrain.map_bounds
        # RGB shaded relief, with genuine DEM elevations.
        pixel_y = abs(self.terrain.dem.transform.e) * self.terrain.meters_per_unit
        pixel_x = abs(self.terrain.dem.transform.a) * self.terrain.meters_per_unit
        shade = LightSource(azdeg=315, altdeg=40).shade(
            np.where(np.isfinite(arr), arr, float(np.nanmedian(arr))),
            cmap=MARS_COLORS, vert_exag=2.0, dx=pixel_x, dy=pixel_y,
            blend_mode="soft", fraction=1.3,
        )
        shade[~self.terrain.has_data, 3] = 0
        ax.imshow(shade, extent=(x0, x1, y0, y1), origin="upper", interpolation="nearest")
        route = self.waypoints
        if self.detour_plan is not None:
            direct_line = self.terrain.fixed_points
            ax.plot(direct_line[:, 0], direct_line[:, 1], color=TEXT, lw=1.8,
                    ls="--", alpha=.75, zorder=3, label="DIRECT REFERENCE")
        ax.plot(route[:, 0], route[:, 1], color="#051b29", lw=8, solid_capstyle="round", zorder=4)
        bands = self.traversability.interval_bands
        sample_pairs = np.stack([profile.xy[:-1], profile.xy[1:]], axis=1)
        ax.add_collection(LineCollection(sample_pairs[bands != "unknown"],
                        colors=[SLOPE_COLORS[b] for b in bands if b != "unknown"],
                        linewidths=3.7, zorder=5))
        if np.any(bands == "unknown"):
            ax.add_collection(LineCollection(sample_pairs[bands == "unknown"],
                              colors=SLOPE_COLORS["unknown"], linewidths=3.7,
                              linestyles="dashed", zorder=5))
        handles = [Line2D([0], [0], color=SLOPE_COLORS[b], lw=3,
                          ls="--" if b == "unknown" else "-") for b in SLOPE_COLORS]
        legend = ax.legend(handles, ["GENTLE", "MODERATE", "STEEP", "VERY STEEP", "NO DATA"],
                           loc="lower center", ncol=5, fontsize=7, framealpha=.92,
                           facecolor=BG, edgecolor=BORDER, labelcolor=TEXT,
                           columnspacing=1.1, handlelength=1.3, borderpad=.5)
        legend.set_zorder(20)
        if len(route) > 2:
            ax.scatter(route[1:-1, 0], route[1:-1, 1], s=82, c=GOLD,
                       edgecolors=BG, linewidths=1.9, zorder=8)
            show_every = max(1, int(np.ceil((len(route) - 2) / 10)))
            for i, (x, y) in enumerate(route[1:-1], 1):
                if i % show_every != 0:
                    continue
                ax.text(x, y + self._point_tolerance() * 1.25, str(i),
                        color=TEXT, fontsize=9, ha="center", fontweight="bold", zorder=9)
        for i, (name, color) in enumerate([("A  /  BASE", TEAL), ("B  /  SCIENCE", GOLD)]):
            x, y = route[0 if i == 0 else -1]
            ax.scatter([x], [y], s=200, c=color, edgecolors="#081923", linewidths=3, zorder=10)
            ax.annotate(name, (x, y), xytext=(11, 11 if i == 0 else -24),
                        textcoords="offset points", color=TEXT, fontsize=10,
                        fontweight="bold", bbox=dict(facecolor=BG, edgecolor=BORDER, alpha=.9, boxstyle="round,pad=.35"), zorder=11)
        left, right, bottom, top = self.terrain.xy_bounds
        margin = (right-left) * .035
        ax.set_xlim(left-margin, right+margin)
        ax.set_ylim(bottom-margin, top+margin)
        ax.set_aspect("equal")
        ax.grid(color="white", alpha=.08, ls="--")
        center = self.terrain.from_lonlat.transform(
            self.terrain.config["center"]["longitude_e"],
            self.terrain.config["center"]["latitude_n"]
        ) if "center" in self.terrain.config else self.terrain.fixed_points[0]
        ax.xaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{(v-center[0])*self.terrain.meters_per_unit:.0f}"))
        ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{(v-center[1])*self.terrain.meters_per_unit:.0f}"))
        ax.tick_params(colors=MUTED, labelsize=8, length=0)
        for spine in ax.spines.values():
            spine.set_color(BORDER)
        ax.set_title("  ROUTE MAP   /   CLICK TO ADD WAYPOINTS", color=TEXT, loc="left", fontsize=11, fontweight="bold", pad=13)
        ax.set_xlabel("EASTING FROM SITE CENTER  /  METERS", color=MUTED, fontsize=8)
        ax.set_ylabel("NORTHING FROM SITE CENTER  /  METERS", color=MUTED, fontsize=8)

        g = self.chart_ax
        g.clear()
        g.set_facecolor(PANEL)
        d = profile.distance_m
        h = profile.elevation_m
        valid = np.isfinite(h)
        if valid.any():
            g.plot(d, np.ma.masked_invalid(h), color=TEAL, lw=1.0, alpha=.4)
            valid_edges = ((bands != "unknown") & np.isfinite(h[:-1]) & np.isfinite(h[1:]))
            if np.any(valid_edges):
                graph_pairs = np.stack([np.stack([d[:-1], h[:-1]], axis=1),
                                        np.stack([d[1:], h[1:]], axis=1)], axis=1)
                g.add_collection(LineCollection(graph_pairs[valid_edges],
                                 colors=[SLOPE_COLORS[b] for b in bands[valid_edges]],
                                 linewidths=2.8, zorder=5))
            baseline = float(np.nanmin(h)) - 2
            g.fill_between(d, np.where(valid, h, baseline), baseline, where=valid,
                           color=TEAL, alpha=.09)
            g.set_ylim(float(np.nanmin(h)) - 8, float(np.nanmax(h)) + 8)
        # All control points (including fixed start A / end B) appear on the
        # elevation profile. Their measured elevations come from real DEM samples.
        waypoint_distances = profile.waypoint_distance_m
        last_label_px = -float("inf")
        graph_width = max(1, self.chart_ax.bbox.width)
        for i, wd in enumerate(waypoint_distances):
            is_endpoint = i == 0 or i == len(waypoint_distances) - 1
            color = TEAL if i == 0 else GOLD
            g.axvline(wd, color=color, alpha=.58 if is_endpoint else .28,
                      lw=1.2 if is_endpoint else 1, ls="-" if is_endpoint else "--")
            sample_idx = profile_index_at_distance(profile, float(wd))
            if sample_idx is not None and np.isfinite(h[sample_idx]):
                g.scatter([wd], [h[sample_idx]], color=color, s=28 if is_endpoint else 16,
                          edgecolors=BG, linewidths=.8, zorder=6)
            # Suppress overlapping short labels in routes with many turns.
            screen_x = graph_width * (wd / max(profile.total_m, 1))
            if is_endpoint or screen_x - last_label_px >= 34:
                label = "A" if i == 0 else "B" if i == len(waypoint_distances) - 1 else str(i)
                g.text(wd, .97, label, transform=g.get_xaxis_transform(), color=color,
                       fontsize=8, fontweight="bold", ha="left" if i == 0 else "right" if i == len(waypoint_distances) - 1 else "center",
                       va="top", zorder=7)
                last_label_px = screen_x
        if profile.missing_count:
            # Missing DEM samples are breaks, not elevations; indicate them
            # at the graph baseline without constructing fake terrain values.
            missing = ~valid
            if valid.any():
                g.scatter(d[missing], np.full(missing.sum(), float(np.nanmin(h)) - 4),
                          marker="x", s=22, c=BAD, linewidths=1.2, zorder=5)
        if stats.max_slope_start_m is not None:
            # Emphasize only the steepest *measured* DEM interval, not a safe/unsafe boundary.
            edge = int(np.searchsorted(profile.distance_m, stats.max_slope_start_m, side="left"))
            xy = profile.xy[edge:edge+2]
            # Mark the absolute maximum measured grade without overriding
            # the user-selected slope-band color of that map interval.
            midpoint = np.mean(xy, axis=0)
            ax.scatter(midpoint[0], midpoint[1], marker="x", s=48,
                       c=TEXT, linewidths=1.6, zorder=11)
            g.axvspan(stats.max_slope_start_m, stats.max_slope_end_m,
                      color="#ffffff", alpha=.10, zorder=1)
        g.set_xlim(0, max(1, profile.total_m))
        g.grid(color="white", alpha=.09, ls="--")
        g.set_title("ELEVATION PROFILE   /   SAMPLED FROM ORIGINAL DEM", loc="left", color=TEXT, fontsize=10, fontweight="bold", pad=12)
        g.set_xlabel("DISTANCE FROM BASE   /   METERS", color=MUTED, fontsize=8)
        g.set_ylabel("ELEVATION   /   METERS", color=MUTED, fontsize=8)
        g.tick_params(colors=MUTED, labelsize=8, length=0)
        for spine in g.spines.values():
            spine.set_color(BORDER)

        # Draw once per route rebuild; hover only moves existing artists.
        self.profile_cursor_line = g.axvline(0, color=GOLD, lw=1.2, alpha=.85, visible=False, zorder=9)
        self.profile_cursor_dot = g.scatter([], [], s=74, color=GOLD, edgecolors=BG,
                                            linewidths=1.8, zorder=10, visible=False)
        self.map_cursor_dot = ax.scatter([], [], s=230, facecolors="none", edgecolors=GOLD,
                                         linewidths=2.5, zorder=12, visible=False)
        self.map_cursor_center = ax.scatter([], [], s=22, c=GOLD, zorder=13, visible=False)
        self.probe_index = None
        self.probe_pinned = False
        self.probe_info.set_text("HOVER OVER THE PROFILE")
        self.probe_detail.set_text("CLICK PROFILE TO PIN")
        self.metric_length.set_text(f"{profile.total_m:,.0f} m")
        self.metric_ascent.set_text("—" if stats.ascent_m is None else f"+{stats.ascent_m:,.1f}")
        self.metric_descent.set_text("—" if stats.descent_m is None else f"−{stats.descent_m:,.1f}")
        self.metric_net.set_text("—" if stats.net_change_m is None else f"{stats.net_change_m:+,.1f}")
        self.metric_slope.set_text("—" if stats.max_slope_deg is None else f"{stats.max_slope_deg:.1f}°")
        self.metric_warning.set_text(
            f"PARTIAL DATA: {stats.analyzed_pct:.0f}% ANALYZED" if stats.has_gaps
            else "20m DEM  /  SAMPLE-BASED"
        )
        self.metric_warning.set_color(BAD if stats.has_gaps else MUTED)
        self.metric_points.set_text(str(len(self.waypoints)))
        self.metric_coverage.set_text(f"{profile.coverage_pct:.1f}%")
        self.metric_coverage.set_color(TEAL if profile.coverage_pct == 100 else BAD)
        warning = f"   •   {profile.missing_count} DEM SAMPLES MISSING" if profile.missing_count else ""
        self.status_text.set_text(
            "●  " + self.last_message + warning +
            f"   /   STEEP+ {self.traversability.difficult_m:.0f} m" +
            f"   /   UNKNOWN {self.traversability.unknown_m:.0f} m"
        )
        self.status_text.set_color(BAD if "REJECTED" in self.last_message or warning else TEAL)
        self.fig.canvas.draw_idle()

    def _on_threshold_submit(self, _value: str):
        """Allow changes to the three experimental cutoffs without rebooting."""
        try:
            values = [float(field.text.strip().replace(",", ".")) for field in self.threshold_fields]
            updated = SlopeThresholds(*values)
        except ValueError:
            self.last_message = "INVALID LIMITS: NEED 0 < A < B < C < 90"
            self.status_text.set_text("●  " + self.last_message)
            self.status_text.set_color(BAD)
            self.fig.canvas.draw_idle()
            return
        self.thresholds = updated
        self.last_message = "EXPERIMENTAL BANDS UPDATED (NOT EVA SAFETY LIMITS)"
        self.refresh()

    def _set_probe(self, index: int | None):
        """Synchronize the two views with a single *measured* DEM sample.

        Mouse moves must not rerun sampling, redraw the terrain, or modify the
        route. Only four existing Matplotlib artists and two text labels move.
        """
        if index == self.probe_index:
            return
        self.probe_index = index
        active = index is not None
        for artist in (self.profile_cursor_line, self.profile_cursor_dot,
                       self.map_cursor_dot, self.map_cursor_center):
            artist.set_visible(active)
        if not active:
            self.probe_info.set_text("HOVER OVER THE PROFILE")
            self.probe_detail.set_text("CLICK PROFILE TO PIN")
        else:
            d = float(self.profile.distance_m[index])
            z = float(self.profile.elevation_m[index])
            xy = self.profile.xy[index]
            status = str(self.profile.sample_status[index])
            self.profile_cursor_line.set_xdata([d, d])
            self.profile_cursor_dot.set_offsets([[d, z]] if np.isfinite(z) else np.empty((0, 2)))
            self.map_cursor_dot.set_offsets([xy])
            self.map_cursor_center.set_offsets([xy])
            self.probe_info.set_text(f"{d:,.0f} m   /   {z:,.2f} m" if np.isfinite(z) else f"{d:,.0f} m   /   NODATA")
            self.probe_detail.set_text(f"DEM: {status.upper()}  •  " + ("PINNED" if self.probe_pinned else "LIVE CURSOR"))
        self.fig.canvas.draw_idle()

    def load(self, path: Path):
        """Load a previously exported route with its stable fixed endpoints."""
        data = json.loads(path.read_text(encoding="utf-8"))
        pts = np.asarray([[p["x"], p["y"]] for p in data["waypoints"]], dtype=float)
        if pts.ndim != 2 or pts.shape[1] != 2 or len(pts) < 2:
            raise ValueError("Invalid waypoint JSON")
        if not np.allclose(pts[[0, -1]], self.terrain.fixed_points, atol=1e-3, rtol=0):
            raise ValueError("Route endpoints differ from this study site")
        if not all(self.terrain.is_valid(p) for p in pts):
            raise ValueError("Imported route contains point(s) outside valid DEM")
        self.history.append(self.waypoints.copy())
        self.detour_plan = None
        self.detour_reference = None
        self.waypoints = pts
        self.last_message = f"LOADED {len(pts)} ROUTE NODES"
        self.refresh()

    def export(self, _event=None):
        profile = self.calculate()
        stats = calculate_route_metrics(profile)
        risks = analyze_traversability(profile, self.thresholds)
        dem_sha256 = self.terrain.dem_sha256()
        output = self.output
        output.mkdir(parents=True, exist_ok=True)
        lon, lat = self.terrain.to_lonlat.transform(profile.xy[:, 0], profile.xy[:, 1])
        write_profile_csv(output / "route_profile.csv", profile,
                          latitude_n=lat, longitude_e=lon,
                          interval_slope_deg=risks.interval_slope_deg)
        with (output / "route_traversability.csv").open("w", newline="", encoding="utf-8") as file:
            writer = csv.writer(file)
            writer.writerow(["interval_start_m", "interval_end_m", "length_m", "measured_slope_deg", "slope_band"])
            for i, (slope, band, length) in enumerate(zip(risks.interval_slope_deg,
                                                           risks.interval_bands, risks.interval_lengths_m)):
                writer.writerow([f"{profile.distance_m[i]:.3f}", f"{profile.distance_m[i+1]:.3f}",
                                 f"{length:.3f}", f"{slope:.3f}" if np.isfinite(slope) else "", str(band)])
        points_lon, points_lat = self.terrain.to_lonlat.transform(self.waypoints[:, 0], self.waypoints[:, 1])
        result = {
            "title": "Jezero Traverse - Manual waypoint route",
            "crs_wkt": self.terrain.dem.crs.to_wkt(),
            "dem_sha256": dem_sha256,
            "distance_m": round(profile.total_m, 2),
            "route_metrics": stats.to_dict(),
            "experimental_traversability": risks.to_dict(),
            "detour_planning": (
                {**self.detour_plan.as_dict(),
                 "reference_direct_route_length_m": self.detour_reference.total_m,
                 "final_sampled_route_length_m": profile.total_m,
                 "length_difference_m": profile.total_m - self.detour_reference.total_m,
                 "final_sampled_max_slope_deg": stats.max_slope_deg}
                if self.detour_plan is not None else None
            ),
            "dem_sample_step_max_m": self.step_m,
            "valid_samples_pct": round(profile.coverage_pct, 2),
            "samples_total": int(len(profile.distance_m)),
            "samples_missing": profile.missing_count,
            "dem_status_counts": profile.status_counts,
            "safety_notice": "Research demonstration only; DEM resolution cannot verify small hazards or astronaut safety.",
            "waypoints": [{"x": float(x), "y": float(y), "latitude_n": float(la), "longitude_e": float(lo)}
                          for (x, y), la, lo in zip(self.waypoints, points_lat, points_lon)]
        }
        (output / "route_waypoints.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        self.fig.savefig(output / "route_profile.png", dpi=170, facecolor=self.fig.get_facecolor())
        save_elevation_png(output / "elevation_profile.png", profile, risks.interval_slope_deg)
        self.last_message = f"EXPORTED CSV / JSON / PNG  →  {output}"
        self.refresh()
        print(f"Route exported: {output / 'route_profile.csv'}")
        print(f"Waypoints exported: {output / 'route_waypoints.json'}")
        print(f"Dashboard: {output / 'route_profile.png'}")
        print(f"Elevation profile: {output / 'elevation_profile.png'}")
        print(f"Experimental slope bands: {output / 'route_traversability.csv'}")


def main():
    parser = argparse.ArgumentParser(description="Interactive Jezero waypoint route planner")
    parser.add_argument("--dem", help="Path to original USGS Jezero DEM (.tif)")
    parser.add_argument("--config", type=Path, default=SITE / "site_config.json")
    parser.add_argument("--step", type=float, default=20.0, help="Maximum sample spacing (meters)")
    parser.add_argument("--auto-detour", action="store_true", help="Build an A* experimental detour from fixed endpoints")
    parser.add_argument("--detour-penalty", type=float, default=12.0, help="Penalty for DEM-derived longitudinal grade")
    parser.add_argument("--detour-max-grade", type=float, default=None, help="Optional strict maximum DEM grid-edge grade (degrees)")
    parser.add_argument("--slope-bands", nargs=3, type=float, default=[5, 10, 15],
                        metavar=("LOW", "MOD", "HIGH"),
                        help="Experimental upper bounds in degrees: 0 < LOW < MOD < HIGH < 90")
    parser.add_argument("--output", type=Path, default=ROOT, help="Directory for CSV, JSON, PNG exports")
    parser.add_argument("--export-only", action="store_true", help="Export direct or loaded route without opening interactive UI")
    parser.add_argument("--load", type=Path, help="Load previously exported route_waypoints.json")
    args = parser.parse_args()
    if args.step <= 0:
        parser.error("--step must be positive")
    if not np.isfinite(args.detour_penalty) or args.detour_penalty < 0:
        parser.error("--detour-penalty must be nonnegative")
    if args.detour_max_grade is not None and not (0 < args.detour_max_grade < 90):
        parser.error("--detour-max-grade must be between 0 and 90 degrees")
    dem_path = locate_dem(args.dem)
    try:
        thresholds = SlopeThresholds(*args.slope_bands)
    except ValueError as exc:
        parser.error(str(exc))
    terrain = Terrain(dem_path, args.config)
    try:
        editor = RouteEditor(terrain, step_m=args.step, output=args.output, thresholds=thresholds)
        editor.detour_penalty = args.detour_penalty
        editor.detour_max_grade = args.detour_max_grade
        if args.auto_detour and args.load:
            parser.error("--auto-detour and --load cannot be used together")
        if args.auto_detour and not editor.auto_detour():
            raise SystemExit(2)
        if args.load:
            editor.load(args.load)
        if args.export_only:
            editor.export()
            plt.close(editor.fig)
        else:
            plt.show()
    finally:
        terrain.close()


if __name__ == "__main__":
    main()
