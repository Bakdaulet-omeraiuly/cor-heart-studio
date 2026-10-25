"""Wrap the open Mindboggle MMRR-21-5 MRI NIfTI in de-identified DICOM files.

The source has no original DICOM metadata. This is a format demo only.
"""

import argparse
import io
import zipfile
from pathlib import Path

import nibabel as nib
import numpy as np
from pydicom.dataset import Dataset, FileDataset
from pydicom.uid import ExplicitVRLittleEndian, MRImageStorage, generate_uid


def export(source: Path, output: Path) -> int:
    image = nib.load(source)
    if len(image.shape) != 3:
        raise ValueError("Expected one 3D MRI volume")
    lps = np.diag([-1.0, -1.0, 1.0, 1.0]) @ image.affine
    vx, vy, vz = lps[:3, 0], lps[:3, 1], lps[:3, 2]
    row, col = vx / np.linalg.norm(vx), vy / np.linalg.norm(vy)
    study_uid, series_uid, frame_uid = generate_uid(), generate_uid(), generate_uid()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=5) as archive:
        for z in range(image.shape[2]):
            pixels = np.asarray(image.dataobj[:, :, z]).T
            pixels = np.ascontiguousarray(np.clip(np.rint(pixels), 0, 65535), dtype="<u2")
            meta = Dataset()
            meta.MediaStorageSOPClassUID = MRImageStorage
            meta.MediaStorageSOPInstanceUID = generate_uid()
            meta.TransferSyntaxUID = ExplicitVRLittleEndian
            meta.ImplementationClassUID = generate_uid()
            ds = FileDataset(None, {}, file_meta=meta, preamble=b"\0" * 128)
            ds.SOPClassUID = MRImageStorage
            ds.SOPInstanceUID = meta.MediaStorageSOPInstanceUID
            ds.StudyInstanceUID = study_uid
            ds.SeriesInstanceUID = series_uid
            ds.FrameOfReferenceUID = frame_uid
            ds.PatientName = "Open^Brain"
            ds.PatientID = "MINDBOGGLE-MMRR-21-5"
            ds.PatientIdentityRemoved = "YES"
            ds.DeidentificationMethod = "Derived from open NIfTI; no original DICOM metadata included"
            ds.Modality = "MR"
            ds.SeriesDescription = "Mindboggle MMRR-21-5 open MRI demo"
            ds.SeriesNumber = 1
            ds.InstanceNumber = z + 1
            ds.ImageOrientationPatient = np.r_[row, col].tolist()
            ds.ImagePositionPatient = (lps @ np.array([0, 0, z, 1]))[:3].tolist()
            ds.PixelSpacing = [float(np.linalg.norm(vy)), float(np.linalg.norm(vx))]
            ds.SliceThickness = float(np.linalg.norm(vz))
            ds.Rows, ds.Columns = pixels.shape
            ds.SamplesPerPixel = 1
            ds.PhotometricInterpretation = "MONOCHROME2"
            ds.BitsAllocated = 16
            ds.BitsStored = 16
            ds.HighBit = 15
            ds.PixelRepresentation = 0
            ds.PixelData = pixels.tobytes()
            buffer = io.BytesIO()
            ds.save_as(buffer, enforce_file_format=True)
            archive.writestr(f"MMRR-21-5/IM{z + 1:04d}.dcm", buffer.getvalue())
    return image.shape[2]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    print(f"Created {export(args.source, args.output)} MRI DICOM slices in {args.output}")


if __name__ == "__main__":
    main()
