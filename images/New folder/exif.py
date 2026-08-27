from pathlib import Path
import csv
from PIL import Image
from PIL.ExifTags import TAGS, GPSTAGS

BASE_FOLDER = Path(__file__).resolve().parent
OUTPUT_CSV = BASE_FOLDER / "gps.csv"


def safe_float(value):
    """
    Safely converts EXIF numeric/rational values to float.

    Returns None for invalid values, including denominator = 0.
    """
    if value is None:
        return None

    try:
        return float(value)
    except (TypeError, ValueError, ZeroDivisionError):
        pass

    try:
        numerator = value.numerator
        denominator = value.denominator

        if denominator == 0:
            return None

        return numerator / denominator

    except (AttributeError, TypeError, ValueError, ZeroDivisionError):
        return None


def get_gps_info(image_path):
    """
    Reads GPSInfo from EXIF and returns a dictionary
    with human-readable GPS tag names.
    """
    try:
        with Image.open(image_path) as img:
            exif = img.getexif()

            if not exif:
                return None

            gps_tag_id = None

            for tag_id in exif:
                if TAGS.get(tag_id, tag_id) == "GPSInfo":
                    gps_tag_id = tag_id
                    break

            if gps_tag_id is None:
                return None

            gps_ifd = exif.get_ifd(gps_tag_id)

            if not gps_ifd:
                return None

            gps_data = {}

            for key, value in gps_ifd.items():
                gps_name = GPSTAGS.get(key, key)
                gps_data[gps_name] = value

            return gps_data

    except Exception as exc:
        print(f"EXIF ERROR: {image_path.name}: {exc}")
        return None


def dms_to_decimal(dms, ref):
    """
    Converts EXIF GPS coordinates to decimal degrees.

    Supports both:

    1. Standard EXIF DMS:
       36, 9, 36

    2. Non-standard decimal-degree EXIF:
       36.160156, 0/0, 0/0

       In this case the first value is already the
       complete decimal coordinate.
    """

    if not dms or len(dms) < 1:
        return None

    degrees = safe_float(dms[0])

    if degrees is None:
        return None

    minutes = None
    seconds = None

    if len(dms) > 1:
        minutes = safe_float(dms[1])

    if len(dms) > 2:
        seconds = safe_float(dms[2])

    # Standard DMS
    if minutes is not None and seconds is not None:
        decimal = (
            degrees
            + (minutes / 60.0)
            + (seconds / 3600.0)
        )

    # Non-standard NM-style EXIF:
    # first value is already decimal degrees
    else:
        decimal = degrees

    ref = str(ref).upper().strip()

    if ref in ("S", "W"):
        decimal *= -1

    return decimal


def extract_coordinates(image_path):
    """
    Extract latitude / longitude from an image.

    Returns:
        (latitude, longitude)

    or:
        None
    """
    gps = get_gps_info(image_path)

    if not gps:
        return None

    lat = gps.get("GPSLatitude")
    lat_ref = gps.get("GPSLatitudeRef")

    lon = gps.get("GPSLongitude")
    lon_ref = gps.get("GPSLongitudeRef")

    if lat is None or lon is None:
        return None

    if lat_ref is None or lon_ref is None:
        return None

    latitude = dms_to_decimal(lat, lat_ref)
    longitude = dms_to_decimal(lon, lon_ref)

    if latitude is None or longitude is None:
        return None

    # Basic sanity checks
    if not (-90 <= latitude <= 90):
        return None

    if not (-180 <= longitude <= 180):
        return None

    return latitude, longitude


def get_image_files():
    """
    Collect JPG/JPEG files once only.

    Using suffix.lower() avoids duplicate matches
    on Windows for .jpg / .JPG etc.
    """
    valid_extensions = {
        ".jpg",
        ".jpeg"
    }

    files = [
        path
        for path in BASE_FOLDER.iterdir()
        if (
            path.is_file()
            and path.suffix.lower() in valid_extensions
        )
    ]

    return sorted(
        files,
        key=lambda path: path.name.lower()
    )


def main():
    image_files = get_image_files()

    if not image_files:
        print()
        print("No JPG/JPEG files found.")
        return

    rows = []
    invalid_files = []

    print()
    print(f"Found {len(image_files)} image(s)")
    print("-" * 70)

    for image_path in image_files:
        try:
            coords = extract_coordinates(image_path)

            if coords is None:
                print(
                    f"INVALID / NO GPS: "
                    f"{image_path.name}"
                )

                invalid_files.append(
                    image_path.name
                )

                continue

            latitude, longitude = coords

            print(
                f"{image_path.name}: "
                f"{latitude:.8f}, "
                f"{longitude:.8f}"
            )

            rows.append([
                image_path.name,
                f"{latitude:.8f}",
                f"{longitude:.8f}"
            ])

        except Exception as exc:
            print(
                f"ERROR: "
                f"{image_path.name}: "
                f"{exc}"
            )

            invalid_files.append(
                image_path.name
            )

    with OUTPUT_CSV.open(
        "w",
        newline="",
        encoding="utf-8"
    ) as csv_file:

        writer = csv.writer(csv_file)

        writer.writerow([
            "FileName",
            "GPSLatitude",
            "GPSLongitude"
        ])

        writer.writerows(rows)

    print()
    print("-" * 70)
    print(f"Created: {OUTPUT_CSV}")
    print(f"Images found:       {len(image_files)}")
    print(f"Images with GPS:    {len(rows)}")
    print(f"Invalid / no GPS:   {len(invalid_files)}")

    if invalid_files:
        print()
        print("Files requiring manual check:")

        for filename in invalid_files:
            print(f"  - {filename}")


if __name__ == "__main__":
    main()