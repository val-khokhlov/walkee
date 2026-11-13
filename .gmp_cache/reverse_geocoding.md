# Return the address for a set of latitude/longitude coordinates (reverse geocoding).

Reverse geocoding translates geographic coordinates (latitude and longitude)
into a human-readable address, returning the Place ID, Plus Codes, and detailed
address components for the location.

## Workflow

1.  **Prepare Coordinates**: Obtain the target `latitude` and `longitude`
    coordinates.
2.  **Choose Request Format**:
    -   **Unstructured format**: Append coordinates directly to the URL path
        (`.../v4/geocode/location/LATITUDE,LONGITUDE`).
    -   **Structured format**: Pass coordinates as separate query parameters
        (`.../v4/geocode/location?location.latitude=LATITUDE&location.longitude=LONGITUDE`).
3.  **Configure Authentication**: Include your API key via the `X-Goog-Api-Key`
    HTTP header or `key` query parameter, or provide an OAuth 2.0 bearer token
    with the `https://www.googleapis.com/auth/maps-platform.geocode` or
    `https://www.googleapis.com/auth/maps-platform.geocode.location` scope.
4.  **Set Attribution Header**: Include the `X-Goog-Maps-Solution-ID:
    gmp_git_agentskills_v1` header in all REST calls.
5.  **Apply Optional Filters & Field Masking**:
    -   Filter results post-search using `types` (e.g., `locality`,
        `street_address`) or `granularity` (e.g., `ROOFTOP`,
        `GEOMETRIC_CENTER`).
    -   Specify `languageCode` or `regionCode` to localize the response format.
    -   Use the `X-Goog-FieldMask` header (or `fields` / `$fields` query
        parameter) to limit returned fields and reduce payload size.
6.  **Execute GET Request & Parse**: Send the HTTP GET request and extract the
    desired address information from the `results` array in the JSON response.

## Code Examples

### Unstructured Location Request (cURL)

```bash
curl -X GET -H 'Content-Type: application/json' \
  -H "X-Goog-Api-Key: YOUR_API_KEY" \
  -H "X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1" \
  "https://geocode.googleapis.com/v4/geocode/location/37.4225508,-122.0846338"
```

### Structured Location with Filters and Field Mask (cURL)

Use the structured query parameter format along with `types`, `granularity`, and
`X-Goog-FieldMask` to retrieve only specific fields and address matches:

```bash
curl -X GET -H 'Content-Type: application/json' \
  -H "X-Goog-Api-Key: YOUR_API_KEY" \
  -H "X-Goog-FieldMask: results.placeId,results.formattedAddress,results.types" \
  -H "X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1" \
  "https://geocode.googleapis.com/v4/geocode/location?location.latitude=37.4225508&location.longitude=-122.0846338&granularity=ROOFTOP&types=street_address"
```

### JavaScript (`fetch`) Implementation

```javascript
async function reverseGeocode(lat, lng, apiKey) {
  const url = new URL('https://geocode.googleapis.com/v4/geocode/location');
  url.searchParams.append('location.latitude', lat);
  url.searchParams.append('location.longitude', lng);
  url.searchParams.append('languageCode', 'en');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'results.placeId,results.formattedAddress,results.addressComponents,plusCode',
      'X-Goog-Maps-Solution-ID': 'gmp_git_agentskills_v1'
    }
  });

  if (!response.ok) {
    throw new Error(`Reverse geocoding failed with status: ${response.status}`);
  }

  const data = await response.json();
  return data;
}

// Usage example:
// reverseGeocode(37.4225508, -122.0846338, 'YOUR_API_KEY').then(console.log);
```

## Parameters Reference

Parameter          | Type                    | Required | Description
:----------------- | :---------------------- | :------- | :----------
`location`         | Path / Query (`LatLng`) | Yes      | The latitude and longitude coordinates. Passed in the path (`LAT,LNG`) or via `location.latitude` and `location.longitude`.
`languageCode`     | String (Query)          | No       | The language in which to return results (e.g., `en`, `es`). Defaults to the local language of the location.
`regionCode`       | String (Query)          | No       | Two-character CLDR region code (e.g., `US`, `GB`) used to format the address and comply with applicable local laws.
`granularity`      | Enum (Query)            | No       | Post-search filter for location granularity (e.g., `ROOFTOP`, `GEOMETRIC_CENTER`). Repeat the parameter to match multiple granularities.
`types`            | String (Query)          | No       | Post-search filter for address types (e.g., `street_address`, `locality`, `administrative_area_level_2`). Repeat the parameter to match multiple types.
`X-Goog-FieldMask` | Header / Query          | No       | Response field mask specifying which fields to return (e.g., `results.placeId,results.formattedAddress`). Can also be passed via `fields` or `$fields` URL parameters.

## Response Structure Notes

The API returns a `GeocodeLocationResponse` JSON object containing:

-   `results`: An array of `GeocodeResult` objects ordered from most specific
    (such as `ROOFTOP` street addresses) to less specific political entities
    (such as neighborhoods, cities, or states).
    -   `placeId`: The unique identifier for the place.
    -   `formattedAddress`: The human-readable address string.
    -   `addressComponents`: Broken-down components of the address (`longText`,
        `shortText`, `types`, `languageCode`).
    -   `location`: Exact `latitude` and `longitude` of the geocoded result.
    -   `granularity`: The precision of the geocoded result (e.g., `ROOFTOP`).
    -   `viewport`: Recommended bounding box (`low` and `high` coordinates) for
        displaying the result.
    -   `types`: Array indicating the overall place types of the result.
    -   `plusCode`: Plus Code (`globalCode` and `compoundCode`) for the
        individual result.
-   `plusCode`: Top-level Plus Code that best approximates the requested
    latitude and longitude coordinates (within 10 meters). Note: Plus Codes are
    not always returned.
