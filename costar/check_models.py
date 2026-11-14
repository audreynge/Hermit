import sys
from pathlib import Path

from pydantic import BaseModel

from costar import models

DATASETS = {
    "commercial-property": models.CommercialProperty,
    "commercial-listing-summary": models.CommercialListingSummary,
    "location-occupancy": models.LocationOccupancy,
    "company-detail": models.CompanyDetail,
    "commercial-sale-comp": models.CommercialSaleComp,
    "apartment-listing": models.ApartmentListing,
    "residential-listings": models.ResidentialListingDetail,
    "residential-listing-features": models.ResidentialListingFeatures,
}


def main(data_dir: Path) -> None:
    for name, model in DATASETS.items():
        n = 0
        with open(data_dir / f"{name}.jsonl") as f:
            for n, line in enumerate(f, 1):
                rec: BaseModel = model.model_validate_json(line)
        print(f"{name}: {n} ok")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
