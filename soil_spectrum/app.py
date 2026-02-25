"""Flask web app for soil spectrum composition analysis."""

import base64
import io
from typing import Dict, Optional

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from flask import Flask, render_template, request

from analyzer import analyze_spectra, decode_image


app = Flask(__name__)
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg"}


def allowed_file(filename: str) -> bool:
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def fig_to_base64() -> str:
    """Serialize current matplotlib figure as base64 PNG for HTML embedding."""
    buffer = io.BytesIO()
    plt.tight_layout()
    plt.savefig(buffer, format="png", dpi=140)
    plt.close()
    buffer.seek(0)
    return base64.b64encode(buffer.read()).decode("utf-8")


def plot_intensity(wavelengths, intensity, title: str, color: str) -> str:
    """Create intensity vs wavelength plot and return base64 image."""
    plt.figure(figsize=(8, 3.2))
    plt.plot(wavelengths, intensity, color=color, linewidth=2)
    plt.title(title)
    plt.xlabel("Wavelength (nm)")
    plt.ylabel("Normalized Intensity")
    plt.xlim(400, 700)
    plt.grid(alpha=0.25)
    return fig_to_base64()


def plot_absorbance(wavelengths, absorbance, regions) -> str:
    """Create absorbance plot with highlighted significant absorption regions."""
    plt.figure(figsize=(8, 3.2))
    plt.plot(wavelengths, absorbance, color="#5e35b1", linewidth=2, label="Absorbance")

    for idx, (start_nm, end_nm) in enumerate(regions):
        label = "Significant absorption" if idx == 0 else None
        plt.axvspan(start_nm, end_nm, color="#ef9a9a", alpha=0.35, label=label)

    plt.title("Absorbance vs Wavelength")
    plt.xlabel("Wavelength (nm)")
    plt.ylabel("A = log10(I₀/I)")
    plt.xlim(400, 700)
    plt.grid(alpha=0.25)
    if regions:
        plt.legend(loc="best")
    return fig_to_base64()


@app.route("/", methods=["GET", "POST"])
def index():
    error = None
    results: Optional[Dict[str, object]] = None

    if request.method == "POST":
        ref_file = request.files.get("reference_image")
        soil_file = request.files.get("soil_image")

        if not ref_file or not soil_file or not ref_file.filename or not soil_file.filename:
            error = "Please upload both the reference spectrum and soil spectrum images."
        elif not allowed_file(ref_file.filename) or not allowed_file(soil_file.filename):
            error = "Only PNG and JPEG files are supported."
        else:
            try:
                ref_image = decode_image(ref_file.read())
                soil_image = decode_image(soil_file.read())

                analysis = analyze_spectra(ref_image, soil_image)

                results = {
                    "reference_plot": plot_intensity(
                        analysis["wavelengths"],
                        analysis["reference_intensity"],
                        "Reference Spectrum Intensity (I₀)",
                        "#1e88e5",
                    ),
                    "soil_plot": plot_intensity(
                        analysis["wavelengths"],
                        analysis["sample_intensity"],
                        "Soil Spectrum Intensity (I)",
                        "#43a047",
                    ),
                    "absorbance_plot": plot_absorbance(
                        analysis["wavelengths"], analysis["absorbance"], analysis["regions"]
                    ),
                    "regions": analysis["regions"],
                    "interpretation": analysis["interpretation"],
                    "reference_band": analysis["reference_band"],
                    "sample_band": analysis["sample_band"],
                }
            except Exception as exc:  # noqa: BLE001 - show readable message in UI
                error = f"Analysis failed: {exc}"

    return render_template("index.html", error=error, results=results)


if __name__ == "__main__":
    app.run(debug=True)
