"""Fetch selected cases of the TotalSegmentator v1 dataset without downloading the 28 GB archive.

Dataset: Wasserthal et al., "TotalSegmentator", Zenodo record 6802614 (v1.0), CC BY 4.0.
Only v1 has per-chamber heart labels; v2 merged them into a single `heart` label.

The archive is read through HTTP range requests: the zip central directory is fetched once, then only
the members we ask for.

    python -m cor_pipeline.fetch_totalseg --meta ../data/totalseg_v1
    python -m cor_pipeline.fetch_totalseg ../data/totalseg_v1 s0011 s0287
"""

import argparse
import http.client
import io
import time
import urllib.request
import zipfile
from pathlib import Path

URL = "https://zenodo.org/records/6802614/files/Totalsegmentator_dataset.zip?download=1"
ROOT = "Totalsegmentator_dataset/"
HEART_FILES = [
    "heart_myocardium",
    "heart_atrium_left",
    "heart_ventricle_left",
    "heart_atrium_right",
    "heart_ventricle_right",
    "aorta",
    "pulmonary_artery",
    "inferior_vena_cava",  # dataset label used for the atlas-grade heart (vena cava, provenance "dataset")
]


class HttpRangeFile(io.RawIOBase):
    """Read-only, seekable view of a remote file, fetched in byte ranges with retries."""

    def __init__(self, url: str, retries: int = 5):
        self.url, self.retries, self.pos = url, retries, 0
        with urllib.request.urlopen(urllib.request.Request(url, method="HEAD")) as response:
            self.size = int(response.headers["Content-Length"])

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=io.SEEK_SET):
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self.pos, io.SEEK_END: self.size}[whence]
        self.pos = base + offset
        return self.pos

    def readinto(self, buffer):
        end = min(self.pos + len(buffer), self.size) - 1
        if end < self.pos:
            return 0
        request = urllib.request.Request(self.url, headers={"Range": f"bytes={self.pos}-{end}"})
        for attempt in range(self.retries):
            try:
                with urllib.request.urlopen(request, timeout=120) as response:
                    data = response.read()
                if len(data) == end - self.pos + 1:
                    break
            except (OSError, http.client.HTTPException):
                pass
            time.sleep(2**attempt)
        else:
            raise OSError(f"range {self.pos}-{end} failed after {self.retries} attempts")
        buffer[: len(data)] = data
        self.pos += len(data)
        return len(data)


def open_archive() -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BufferedReader(HttpRangeFile(URL), buffer_size=1 << 20))


def fetch_cases(archive: zipfile.ZipFile, cases: list[str], out_dir: Path, with_ct: bool) -> None:
    names = set(archive.namelist())
    for case in cases:
        members = [f"{ROOT}{case}/segmentations/{label}.nii.gz" for label in HEART_FILES]
        if with_ct:
            members.append(f"{ROOT}{case}/ct.nii.gz")
        for member in members:
            if member not in names:
                print(f"  missing in archive: {member}")
                continue
            target = out_dir / member[len(ROOT):]
            if target.exists():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(member))
        print(f"{case}: done")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("out_dir")
    parser.add_argument("cases", nargs="*")
    parser.add_argument("--meta", action="store_true", help="download meta.csv only")
    parser.add_argument("--with-ct", action="store_true", help="also download the CT image (large)")
    args = parser.parse_args()

    out = Path(args.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    archive = open_archive()
    if args.meta:
        (out / "meta.csv").write_bytes(archive.read(f"{ROOT}meta.csv"))
        print(f"meta.csv -> {out}")
    fetch_cases(archive, args.cases, out, args.with_ct)


if __name__ == "__main__":
    main()
