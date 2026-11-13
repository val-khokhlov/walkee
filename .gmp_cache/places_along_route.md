# Search Along Route

## Capability Overview

The Search Along Route capability uses the Places API **Text Search (New)**
endpoint (`https://places.googleapis.com/v1/places:searchText`) to return
information about places matching a text query that are located near a
predefined route. By supplying an encoded polyline representing a route, search
results are biased toward locations that require minimal detour times along that
specific path.

## Prerequisites

*   **Google Cloud Project & API Key**: A valid Google Maps Platform API key
    with the **Places API (New)** enabled.
*   **Encoded Route Polyline**: A precalculated encoded polyline string
    representing the route.
    *   You can obtain this by calling the
        [Routes API](https://developers.google.com/maps/documentation/routes/compute_route_directions),
        which outputs an encoded polyline by default.
    *   Alternatively, you can encode your own coordinates using the
        [Encoded Polyline Algorithm Format](https://developers.google.com/maps/documentation/utilities/polylinealgorithm).

## Implementation Workflow

### 1. Prepare Request Headers

All requests to the Text Search (New) endpoint require a `POST` request with the
following HTTP headers:

*   `Content-Type: application/json`
*   `X-Goog-Api-Key: YOUR_API_KEY`
*   `X-Goog-FieldMask`: A comma-separated list of fields to return in the
    response (e.g.,
    `places.displayName,places.formattedAddress,places.priceLevel`). There is no
    default list of returned fields; omitting this header results in an error.
*   `X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1`

### 2. Construct the Request Body

To search along the entire route from its original starting point to its
destination, pass the `textQuery` and the
`searchAlongRouteParameters.polyline.encodedPolyline` object in the JSON
payload.

#### Example: Basic Search Along an Entire Route

```bash
curl -X POST -d '{
  "textQuery" : "Spicy Vegetarian Food",
  "searchAlongRouteParameters": {
    "polyline": {
      "encodedPolyline": "wblcFptchVIFOd@G@EVw@Ms@dHKR}ApNA`AF~@Hf@TjAb@bBb@~@n@p@^Rd@~@Vz@HVz@nDLt@?d@Kr@c@~@mD`G?`@aEfGkCnDuChDm`@bb@[`@{GhHeEdEciBnnBkC`DkC~DaClEuKjT_Z|l@Qb@iR~_@}EzJ_AdB_Und@kAfCaOjZkg@vcAqBzD_]rr@iBlEaBxEgArD}AlG}AhHsA`IeAnH{@dIq@dJgL~iBq@rHu@vGgAtHwArHaBhHkBzG_DpJ}Nbc@iBhGkA|EgC|LcIjb@oAhG_AvDgAdDkApC_BzCiBpCsFvGii@vn@scAxlAmLjNgSzUeRjT{TzWqExEmG|FuNlMmMhLaRvPqOlNmbAl}@mFlF{PlOmJfIoElE}LtMiSbU_H`I}}@jcAwl@vp@oAbBqA~BeAhCm@tBg@fCWrBQ~BI|DaB~rBO~D[bEa@`Dm@pDaAdE{@vC_BbEkB~Def@|z@sEzHKJeS~]}K`S{\\~l@cXpe@sBpDm@bAuCxDkBrBiC~BwCtByBnAcBx@}Bt@{Bn@gh@|LaOpDeFhAoDj@aE^kVrA_E^iEr@yD~@uBr@gMjF_EnAcCh@eFr@_DRsAD}@Jsu@xCWDqIV}BCeCOyDm@cBa@_DmA}JeE_CwAsBcBiBoBuAqBmOoX{CuEkB_CoDqDkVoUoD{CeE_DkEkC_FeCqB}@sDuAoDgAeCe@cCW}CK}BDaDTeOlBcuBrYaNlBq@Dyd@rGyFt@yBb@eBf@oCnAoBlAkIpGkAp@wBbAaCt@oFdAwKjBoGxA{FbByIjC_HfB_@KmNdDuC|@uFzBcH|C{@\\[?sBv@}@VaBVoA@y@EmAQcA[w@]aBkAeAkA}BuDUKs@uAqBsCwBcCgAiAiN_MyKsJsG{GkBaBiBuA{BwAwDkBcOaHiC_AiCg@}BQcCAcBHqBVkB`@qEjAu@LgCVgAHwG@sG?mABsH^eNr@mBXy@NqBt@uAt@aBlAkAlA}BtCyApBiAdB_BxB{A`B}@j@oAf@s@PeCVcIf@gAAkAQy@YiAo@_A{@_DgEgJqM_DeEaM}PoBiCzAsBw@kAdAGVk@f@q@z@C"
    }
  }
}' \
-H 'Content-Type: application/json' \
-H 'X-Goog-Api-Key: API_KEY' \
-H 'X-Goog-FieldMask: places.displayName,places.formattedAddress,places.priceLevel' \
-H 'X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1' \
'https://places.googleapis.com/v1/places:searchText'
```

### 3. Override the Route Origin (Optional)

If a user is already partially along the route when performing the search, you
do not have to bias the results to the entire polyline. Specify an explicit
routing origin using `routingParameters.origin` to override the initial origin
defined in the encoded polyline.

#### Example: Search Along Route with Custom Origin

```bash
curl -X POST -d '{
  "textQuery" : "Spicy Vegetarian Food",
  "searchAlongRouteParameters": {
    "polyline": {
      "encodedPolyline": "ROUTE_POLYLINE"
    }
  },
  "routingParameters": {
    "origin": {
      "latitude": 37.56617,
      "longitude": -122.30870
    }
  }
}' \
-H 'Content-Type: application/json' \
-H 'X-Goog-Api-Key: API_KEY' \
-H 'X-Goog-FieldMask: places.displayName,places.formattedAddress,places.priceLevel' \
-H 'X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1' \
'https://places.googleapis.com/v1/places:searchText'
```

### 4. Handle the Response

The API returns a JSON object containing a `places` array with items matching
the query and the requested field mask, biased to the provided route:

```json
{
  "places": [
    {
      "formattedAddress": "60 Morris St, San Francisco, CA 94107, USA",
      "priceLevel": "PRICE_LEVEL_MODERATE",
      "displayName": {
        "text": "Umami Express",
        "languageCode": "en"
      }
    },
    {
      "formattedAddress": "1130 4th St, San Francisco, CA 94158, USA",
      "priceLevel": "PRICE_LEVEL_MODERATE",
      "displayName": {
        "text": "House of Tadu Ethiopian Kitchen",
        "languageCode": "en"
      }
    },
    {
      "formattedAddress": "1602 El Camino Real Ste A, Belmont, CA 94002, USA",
      "priceLevel": "PRICE_LEVEL_MODERATE",
      "displayName": {
        "text": "Eats Meets West Bowls",
        "languageCode": "en"
      }
    }
  ]
}
```

## Important Considerations & Limitations

*   **Polyline Format**: Search along route only supports an encoded polyline
    passed as a compressed string. Raw coordinate arrays are not directly
    accepted in `searchAlongRouteParameters`.
*   **Close or Identical Origin and Destination**: Because search along route
    optimizes for places with minimal detour times from origin to destination,
    routes where the origin and destination are the same (e.g., a loop) or very
    close to one another may return no results.
