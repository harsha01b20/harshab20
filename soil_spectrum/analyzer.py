"""Core spectrum processing utilities for soil sample analysis."""

from dataclasses import dataclass
from typing import Dict, List, Tuple

import cv2
import numpy as np


VISIBLE_MIN_NM = 400.0
VISIBLE_MAX_NM = 700.0
EPSILON = 1e-6


@dataclass
class SpectrumProfile:
    """Represents a processed spectrum profile."""

    wavelengths: np.ndarray
    intensity: np.ndarray
    normalized_intensity: np.ndarray
    band_bounds: Tuple[int, int]


def decode_image(file_bytes: bytes) -> np.ndarray:
    """Decode uploaded PNG/JPEG bytes into an OpenCV BGR image."""
    array = np.frombuffer(file_bytes, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not decode image. Please upload a valid PNG or JPEG file.")
    return image


def detect_spectrum_band(gray_image: np.ndarray, band_half_height: int = 6) -> Tuple[int, int]:
    """Detect the brightest horizontal band in a grayscale spectrum image."""
    # Smooth the image slightly to reduce single-pixel noise before row averaging.
    blurred = cv2.GaussianBlur(gray_image, (5, 5), 0)

    # Compute mean brightness for each horizontal row.
    row_means = blurred.mean(axis=1)

    # Pick the row with highest average intensity as the center of the spectrum band.
    center_row = int(np.argmax(row_means))

    # Build a narrow band around the center row while keeping bounds in range.
    top = max(0, center_row - band_half_height)
    bottom = min(gray_image.shape[0], center_row + band_half_height + 1)
    return top, bottom


def extract_intensity_profile(image: np.ndarray) -> SpectrumProfile:
    """Extract a 1D intensity profile from the detected spectrum band."""
    # Convert BGR image to grayscale as requested for intensity extraction.
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Detect the brightest horizontal spectrum region.
    top, bottom = detect_spectrum_band(gray)

    # Slice the narrow horizontal spectrum band and average vertically.
    band_slice = gray[top:bottom, :]
    intensity = band_slice.mean(axis=0).astype(np.float64)

    # Linearly map pixel columns to visible wavelengths from 400 to 700 nm.
    wavelengths = np.linspace(VISIBLE_MIN_NM, VISIBLE_MAX_NM, num=intensity.size)

    # Normalize intensity to [0, 1] for robust comparison between images.
    min_val = float(np.min(intensity))
    max_val = float(np.max(intensity))
    if max_val - min_val < EPSILON:
        normalized = np.zeros_like(intensity)
    else:
        normalized = (intensity - min_val) / (max_val - min_val)

    return SpectrumProfile(
        wavelengths=wavelengths,
        intensity=intensity,
        normalized_intensity=normalized,
        band_bounds=(top, bottom),
    )


def align_profiles(
    reference: SpectrumProfile,
    sample: SpectrumProfile,
    points: int = 600,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Interpolate both profiles to a shared wavelength grid."""
    common_wavelengths = np.linspace(VISIBLE_MIN_NM, VISIBLE_MAX_NM, num=points)
    ref_interp = np.interp(common_wavelengths, reference.wavelengths, reference.normalized_intensity)
    sample_interp = np.interp(common_wavelengths, sample.wavelengths, sample.normalized_intensity)
    return common_wavelengths, ref_interp, sample_interp


def compute_absorbance(reference_intensity: np.ndarray, sample_intensity: np.ndarray) -> np.ndarray:
    """Compute absorbance using A = log10(I0 / I) with epsilon protection."""
    safe_reference = np.clip(reference_intensity, EPSILON, None)
    safe_sample = np.clip(sample_intensity, EPSILON, None)
    return np.log10(safe_reference / safe_sample)


def find_significant_absorption_regions(
    wavelengths: np.ndarray,
    absorbance: np.ndarray,
) -> List[Tuple[float, float]]:
    """Find continuous wavelength regions with high absorbance."""
    threshold = float(absorbance.mean() + absorbance.std())
    mask = absorbance >= threshold

    regions: List[Tuple[float, float]] = []
    start_idx = None

    for idx, is_high in enumerate(mask):
        if is_high and start_idx is None:
            start_idx = idx
        elif not is_high and start_idx is not None:
            regions.append((float(wavelengths[start_idx]), float(wavelengths[idx - 1])))
            start_idx = None

    if start_idx is not None:
        regions.append((float(wavelengths[start_idx]), float(wavelengths[-1])))

    return regions


def interpret_absorption(
    wavelengths: np.ndarray,
    absorbance: np.ndarray,
    ref_intensity: np.ndarray,
    sample_intensity: np.ndarray,
) -> Dict[str, str]:
    """Return simple rule-based interpretation of spectrum behavior."""

    def mean_in_range(start_nm: float, end_nm: float) -> float:
        range_mask = (wavelengths >= start_nm) & (wavelengths <= end_nm)
        if not np.any(range_mask):
            return 0.0
        return float(absorbance[range_mask].mean())

    blue_abs = mean_in_range(400, 500)
    red_abs = mean_in_range(600, 700)

    intensity_ratio = float(np.mean(sample_intensity) / (np.mean(ref_intensity) + EPSILON))

    interpretation = {
        "blue": (
            "Higher blue absorption detected; this may indicate higher organic matter content."
            if blue_abs > 0.15
            else "Blue absorption is not dominant; organic matter signal appears limited."
        ),
        "red": (
            "Higher red absorption detected; this can be associated with iron oxide presence."
            if red_abs > 0.15
            else "Red absorption is moderate/low; iron oxide signal is not strongly pronounced."
        ),
        "overall": (
            "Overall intensity drop is significant; scattering/turbidity may be elevated."
            if intensity_ratio < 0.75
            else "Overall intensity is relatively preserved; limited scattering/turbidity effects."
        ),
    }

    return interpretation


def analyze_spectra(reference_image: np.ndarray, sample_image: np.ndarray) -> Dict[str, object]:
    """Full analysis pipeline for reference and soil spectrum images."""
    reference_profile = extract_intensity_profile(reference_image)
    sample_profile = extract_intensity_profile(sample_image)

    wavelengths, ref_interp, sample_interp = align_profiles(reference_profile, sample_profile)
    absorbance = compute_absorbance(ref_interp, sample_interp)
    regions = find_significant_absorption_regions(wavelengths, absorbance)

    interpretation = interpret_absorption(wavelengths, absorbance, ref_interp, sample_interp)

    return {
        "wavelengths": wavelengths,
        "reference_intensity": ref_interp,
        "sample_intensity": sample_interp,
        "absorbance": absorbance,
        "regions": regions,
        "interpretation": interpretation,
        "reference_band": reference_profile.band_bounds,
        "sample_band": sample_profile.band_bounds,
    }
