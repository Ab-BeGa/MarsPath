"""Read the original Mars DEM without confusing NoData with out-of-bounds.

Status meanings:
    valid        – finite elevation sampled from a valid source DEM cell
    nodata       – point falls on a masked or non-finite DEM cell
    outside_roi  – inside the original DEM but outside the selected study region
    outside_dem  – projected point falls beyond the original raster's valid pixels
    invalid_xy   – non-finite projected coordinates

The source DEM supplies heights, never the downsampled map preview.
"""
from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import rasterio

STATUS_VALID = "valid"
STATUS_NODATA = "nodata"
STATUS_OUTSIDE_ROI = "outside_roi"
STATUS_OUTSIDE_DEM = "outside_dem"
STATUS_INVALID_XY = "invalid_xy"
ALL_STATUSES = frozenset({STATUS_VALID, STATUS_NODATA, STATUS_OUTSIDE_ROI, STATUS_OUTSIDE_DEM, STATUS_INVALID_XY})


def sample_dem_points(
    dem: rasterio.io.DatasetReader,
    xy: Sequence[Sequence[float]] | np.ndarray,
    roi_bounds: tuple[float, float, float, float] | None = None,
) -> tuple[np.ndarray, np.ndarray]:
    """Return (elevations_m, per-point status) in exactly the supplied order.

    Coordinates must be in the projected CRS of *dem*. ROI bounds are
    (left, right, bottom, top) in the same units. The original raster's
    mask/NoData controls validity. No interpolation or fill is performed.
    """
    points = np.asarray(xy, dtype=float)
    if points.ndim != 2 or points.shape[1] != 2:
        raise ValueError("Expected an N×2 array of projected XY positions")
    if roi_bounds is not None:
        left, right, bottom, top = roi_bounds
        if not np.isfinite([left, right, bottom, top]).all() or left >= right or bottom >= top:
            raise ValueError("Invalid ROI bounds")

    values = np.full(len(points), np.nan, dtype=float)
    status = np.full(len(points), STATUS_INVALID_XY, dtype="<U16")
    finite_indices = np.flatnonzero(np.isfinite(points).all(axis=1))
    if not len(finite_indices):
        return values, status

    # Rasterio's pixel indexing accounts for GeoTIFF affine transform and
    # distinguishes the last pixel from just-outside-dataset coordinates.
    selected = []
    for idx in finite_indices:
        x, y = (float(v) for v in points[idx])
        row, col = dem.index(x, y)
        if not (0 <= row < dem.height and 0 <= col < dem.width):
            status[idx] = STATUS_OUTSIDE_DEM
        elif roi_bounds is not None and not (left <= x <= right and bottom <= y <= top):
            status[idx] = STATUS_OUTSIDE_ROI
        else:
            status[idx] = STATUS_NODATA
            selected.append(idx)

    if selected:
        samples = dem.sample(points[selected], indexes=1, masked=True)
        for idx, result in zip(selected, samples, strict=True):
            value = result[0]
            if not np.ma.is_masked(value) and np.isfinite(value):
                values[idx] = float(value)
                status[idx] = STATUS_VALID

    return values, status
