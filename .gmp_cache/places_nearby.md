# Return a list of places and place details near a specific location

Use the Nearby Search (New) endpoint to find matching places within a specified
circular geographic area, optionally filtered by place types, and retrieve
specific place details using a field mask.

## Endpoint & Request Structure

Nearby Search (New) only supports HTTP `POST` requests:

```http
POST https://places.googleapis.com/v1/places:searchNearby
```

### Required Headers

-   `Content-Type: application/json`
-   `X-Goog-Api-Key: YOUR_API_KEY`
-   `X-Goog-FieldMask: <comma-separated-fields>` (No spaces allowed in the field
    list. E.g., `places.id,places.displayName,places.formattedAddress`)
-   `X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1`

--------------------------------------------------------------------------------

## Parameters

### Required Parameters

#### 1. `X-Goog-FieldMask` (Header or `$fields` URL parameter)

There is no default list of returned fields; omitting the field mask returns an
error. Request only the fields you need to optimize processing time and avoid
higher SKU billing charges. Do not use the wildcard (`*`) in production.

*   **Nearby Search Pro SKU Fields:** `places.accessibilityOptions`,
    `places.addressComponents`, `places.addressDescriptor`,
    `places.adrFormatAddress`, `places.attributions`, `places.businessStatus`,
    `places.consumerAlert`, `places.containingPlaces`, `places.displayName`,
    `places.formattedAddress`, `places.googleMapsLinks`,
    `places.googleMapsTypeLabel`, `places.googleMapsUri`,
    `places.iconBackgroundColor`, `places.iconMaskBaseUri`, `places.id`,
    `places.location`, `places.name` (resource name `places/PLACE_ID`),
    `places.movedPlace`, `places.movedPlaceId`, `places.openingDate`,
    `places.photos`, `places.plusCode`, `places.postalAddress`,
    `places.primaryType`, `places.primaryTypeDisplayName`,
    `places.pureServiceAreaBusiness`, `places.shortFormattedAddress`,
    `places.subDestinations`, `places.timeZone`, `places.types`,
    `places.utcOffsetMinutes`, `places.viewport`.
*   **Nearby Search Enterprise SKU Fields:** `places.currentOpeningHours`,
    `places.currentSecondaryOpeningHours`, `places.internationalPhoneNumber`,
    `places.nationalPhoneNumber`, `places.priceLevel`, `places.priceRange`,
    `places.rating`, `places.regularOpeningHours`,
    `places.regularSecondaryOpeningHours`, `places.transitStation`,
    `places.userRatingCount`, `places.websiteUri`.
*   **Nearby Search Enterprise + Atmosphere SKU Fields:** `places.allowsDogs`,
    `places.curbsidePickup`, `places.delivery`, `places.dineIn`,
    `places.editorialSummary`, `places.evChargeAmenitySummary`,
    `places.evChargeOptions`, `places.fuelOptions`, `places.generativeSummary`,
    `places.goodForChildren`, `places.goodForGroups`,
    `places.goodForWatchingSports`, `places.liveMusic`,
    `places.menuForChildren`, `places.neighborhoodSummary`,
    `places.parkingOptions`, `places.paymentOptions`, `places.outdoorSeating`,
    `places.reservable`, `places.restroom`, `places.reviews`,
    `places.reviewSummary`, `routingSummaries`, `places.servesBeer`,
    `places.servesBreakfast`, `places.servesBrunch`, `places.servesCocktails`,
    `places.servesCoffee`, `places.servesDessert`, `places.servesDinner`,
    `places.servesLunch`, `places.servesVegetarianFood`, `places.servesWine`,
    `places.takeout`.
*   **Navigation & Entrance Fields:** `places.entrances`,
    `places.navigationPoints`.

#### 2. `locationRestriction` (JSON Body)

Defines the region to search as a `circle` with a `center` (`latitude` and
`longitude`) and `radius` in meters. The radius must be strictly greater than
`0.0` and at most `50000.0`.

```json
"locationRestriction": {
  "circle": {
    "center": {
      "latitude": 37.7937,
      "longitude": -122.3965
    },
    "radius": 500.0
  }
}
```

### Optional Parameters (JSON Body)

*   **`includedTypes` / `excludedTypes`**: Arrays of up to 50 place types (from
    Table A) to filter on a place's associated types list. Returns places
    matching at least one `includedTypes` and none of `excludedTypes`.
    Conflicting types across both arrays return an `INVALID_REQUEST` error.
*   **`includedPrimaryTypes` / `excludedPrimaryTypes`**: Arrays of up to 50
    place types (from Table A) to filter on a place's single primary type.
    Specifying a general primary type (e.g., `"restaurant"`) can match places
    with more specific primary types (e.g., `"chinese_restaurant"`). Conflicting
    primary types return an `INVALID_ARGUMENT` error.
*   **`maxResultCount`**: Integer between `1` and `20` (default `20`).
*   **`rankPreference`**:
    *   `"POPULARITY"` (default): Sorts results based on popularity.
    *   `"DISTANCE"`: Sorts results in ascending order by distance from the
        center point.
*   **`languageCode`**: BCP-47 language code (defaults to `"en"`). Returns
    `INVALID_ARGUMENT` if invalid.
*   **`regionCode`**: Two-character CLDR code used to format the response (e.g.,
    `"us"`, `"gb"`). Omits country name from `formattedAddress` if it matches
    the `regionCode`.
*   **`includeFutureOpeningBusinesses`**: Boolean (defaults to `false`). If
    `true`, includes businesses expected to open in the future (pair with
    `places.businessStatus` and `places.openingDate` in the field mask).

--------------------------------------------------------------------------------

## Code Examples

### 1. Basic Search with Type Filtering & Details

Find up to 10 restaurants within 500 meters, returning display names, addresses,
types, and websites:

```bash
curl -X POST -d '{
  "includedTypes": ["restaurant"],
  "maxResultCount": 10,
  "locationRestriction": {
    "circle": {
      "center": {
        "latitude": 37.7937,
        "longitude": -122.3965
      },
      "radius": 500.0
    }
  }
}' \
-H 'Content-Type: application/json' \
-H "X-Goog-Api-Key: YOUR_API_KEY" \
-H "X-Goog-FieldMask: places.displayName,places.formattedAddress,places.types,places.websiteUri" \
-H "X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1" \
https://places.googleapis.com/v1/places:searchNearby
```

### 2. Exclude Types & Rank by Distance

Search for schools excluding primary schools within 1000 meters, sorted by
distance:

```bash
curl -X POST -d '{
  "includedTypes": ["school"],
  "excludedTypes": ["primary_school"],
  "maxResultCount": 10,
  "rankPreference": "DISTANCE",
  "locationRestriction": {
    "circle": {
      "center": {
        "latitude": 37.7937,
        "longitude": -122.3965
      },
      "radius": 1000.0
    }
  }
}' \
-H 'Content-Type: application/json' \
-H "X-Goog-Api-Key: YOUR_API_KEY" \
-H "X-Goog-FieldMask: places.id,places.displayName,places.primaryType" \
-H "X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1" \
https://places.googleapis.com/v1/places:searchNearby
```

### 3. Specialized Data: Transit Stations, Entrances, and Future Businesses

Request transit station details (lines, agencies, departure boards) or entrances
and navigation points by adjusting `includedTypes` and `X-Goog-FieldMask`:

```bash
curl -X POST \
-H "Content-Type: application/json" \
-H "X-Goog-Api-Key: YOUR_API_KEY" \
-H "X-Goog-FieldMask: places.id,places.displayName,places.entrances,places.navigationPoints" \
-H "X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1" \
-d '{
  "includedTypes": ["airport"],
  "maxResultCount": 1,
  "locationRestriction": {
    "circle": {
      "center": {"latitude": 37.6193, "longitude": -122.3816},
      "radius": 1000.0
    }
  }
}' \
"https://places.googleapis.com/v1/places:searchNearby"
```

--------------------------------------------------------------------------------

## Response Format

The endpoint returns a JSON object containing a `places` array where each item
includes only the fields requested in `X-Goog-FieldMask`:

```json
{
  "places": [
    {
      "types": [
        "seafood_restaurant",
        "restaurant",
        "food",
        "point_of_interest",
        "establishment"
      ],
      "formattedAddress": "PIER 1 1/2 The Embarcadero N, San Francisco, CA 94105, USA",
      "websiteUri": "http://lamarsf.com/",
      "displayName": {
        "text": "La Mar Cocina Peruana",
        "languageCode": "en"
      }
    }
  ]
}
```
