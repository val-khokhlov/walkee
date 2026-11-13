---
name: geocoding-api-web-api
description: Use this skill when converting addresses into geographic coordinates (geocoding), translating latitude/longitude coordinates into human-readable addresses (reverse geocoding), or retrieving addresses from Google Place IDs using the Google Maps Platform Geocoding HTTP REST API. It should also be used to restrict requests by viewport, region, country, postal code, or address type, as well as to retrieve building outlines, building entrances, and proximity information to landmarks and areas.
license: Apache-2.0
metadata:
  version: 1.0.54
---

> [!IMPORTANT] **Core Dependency:** This skill requires active context from
> [google-maps-platform/SKILL.md](https://www.gstatic.com/googlemapsplatform-agent-skills/google-maps-platform/SKILL.md).

### Overview

The Google Maps Platform Geocoding API is an HTTP REST web service that provides
geocoding and reverse geocoding of addresses, geographic coordinates, and Google
Place identifiers. Use this skill to convert human-readable addresses into
latitude and longitude coordinates, translate coordinates or Place IDs back into
structured addresses, apply spatial and component filters (such as viewports,
regions, countries, postal codes, and address types), and retrieve advanced
spatial details including building outlines, building entrances, and proximity
to nearby landmarks or areas.

## Primary Orchestration Integration Workflow

Follow this multi-phase sequential integration checklist to compose features
robustly. For each phase, read the referenced capability sub-workflow file and
satisfy its *Evidence Checkpoint* before advancing.

### Phase 1: Feature Layer & Custom Enrichment (Supplemental)

#### Feature Module: Places (Optional - Use-Case Dependent)

-   [ ] **Converts a street address or location name into geographic latitude
    and longitude coordinates via an HTTP geocoding request.** Read
    [references/return-latitudelongitude-coordinates-address-geocoding.md](https://www.gstatic.com/googlemapsplatform-agent-skills/geocoding-api-web-api/references/return-latitudelongitude-coordinates-address-geocoding.md).
    *Trigger Condition*: Use when the user wants to find the latitude and
    longitude coordinates for a physical address. *Evidence Checkpoint*: The
    HTTP response returns a 200 OK status with a JSON payload containing
    geometry.location (lat/lng) for the queried address.
-   [ ] **Converts geographic latitude and longitude coordinates into a
    human-readable street address via an HTTP reverse geocoding request.** Read
    [references/return-address-set-latitudelongitude-coordinates-reverse-geocoding.md](https://www.gstatic.com/googlemapsplatform-agent-skills/geocoding-api-web-api/references/return-address-set-latitudelongitude-coordinates-reverse-geocoding.md).
    *Trigger Condition*: Use when the user wants to convert latitude and
    longitude coordinates into a formatted physical address. *Evidence
    Checkpoint*: The HTTP response returns a 200 OK status with a JSON payload
    containing formatted_address and address_components matching the input
    coordinates.
-   [ ] **Biases or restricts geocoding results to a specific geographic
    bounding box viewport.** Read
    [references/restrict-geocoding-request-return-results-withing-specific-viewport.md](https://www.gstatic.com/googlemapsplatform-agent-skills/geocoding-api-web-api/references/restrict-geocoding-request-return-results-withing-specific-viewport.md).
    *Dependencies*:
    `["references/return-latitudelongitude-coordinates-address-geocoding.md"]` \
    *Trigger Condition*: Use when the user wants to prefer or filter geocoding
    results within a defined rectangular geographic area or viewport bounds.
    *Evidence Checkpoint*: The HTTP request includes the bounds parameter and
    the returned JSON results prioritize or fall within the specified geographic
    viewport.
-   [ ] **Filters geocoding or reverse geocoding results to a specific country,
    administrative area, locality, or postal code using component filtering.**
    Read
    [references/restrict-geocoding-or-reverse-geocoding-request-only-return-results-within-specific-region-country-o.md](https://www.gstatic.com/googlemapsplatform-agent-skills/geocoding-api-web-api/references/restrict-geocoding-or-reverse-geocoding-request-only-return-results-within-specific-region-country-o.md).
    *Trigger Condition*: Use when the user wants to restrict geocoding or
    reverse geocoding results strictly to a specific country, region, or postal
    code. *Evidence Checkpoint*: The HTTP request includes the components
    parameter or region parameter, and the JSON response only contains results
    matching the specified administrative filters.
-   [ ] **Filters reverse geocoding responses to only return results matching
    specified address types or location types.** Read
    [references/restrict-reverse-geocoding-request-only-return-results-specified-address-types.md](https://www.gstatic.com/googlemapsplatform-agent-skills/geocoding-api-web-api/references/restrict-reverse-geocoding-request-only-return-results-specified-address-types.md).
    *Dependencies*:
    `["references/return-address-set-latitudelongitude-coordinates-reverse-geocoding.md"]` \
    *Trigger Condition*: Use when the user wants to filter reverse geocoding
    results by specific address types (e.g., street_address, postal_code) or
    location types (e.g., ROOFTOP). *Evidence Checkpoint*: The HTTP reverse
    geocoding request includes the result_type or location_type parameter, and
    all returned JSON results match the requested types.
-   [ ] **Retrieves address descriptors providing relational proximity
    information to nearby landmarks and areas for a given street address.** Read
    [references/return-information-about-proximity-landmarks-or-areas-address.md](https://www.gstatic.com/googlemapsplatform-agent-skills/geocoding-api-web-api/references/return-information-about-proximity-landmarks-or-areas-address.md).
    *Dependencies*:
    `["references/return-latitudelongitude-coordinates-address-geocoding.md"]` \
    *Trigger Condition*: Use when the user wants to get nearby landmarks and
    area context (address descriptors) when geocoding a physical address.
    *Evidence Checkpoint*: The HTTP geocoding request for an address enables
    address descriptors, and the JSON response includes an address_descriptor
    object with landmarks and areas arrays.
-   [ ] **Retrieves address descriptors providing relational proximity
    information to nearby landmarks and areas for a set of latitude and
    longitude coordinates.** Read
    [references/return-information-about-proximity-landmarks-or-areas-set-latitudelongitude-coordinates.md](https://www.gstatic.com/googlemapsplatform-agent-skills/geocoding-api-web-api/references/return-information-about-proximity-landmarks-or-areas-set-latitudelongitude-coordinates.md).
    *Dependencies*:
    `["references/return-address-set-latitudelongitude-coordinates-reverse-geocoding.md"]` \
    *Trigger Condition*: Use when the user wants to get nearby landmarks and
    area context (address descriptors) when reverse geocoding latitude/longitude
    coordinates. *Evidence Checkpoint*: The HTTP reverse geocoding request
    enables address descriptors, and the JSON response includes an
    address_descriptor object with landmarks and areas arrays.
-   [ ] **Retrieves address descriptors providing relational proximity
    information to nearby landmarks and areas for a specific Google Place ID.**
    Read
    [references/return-information-about-proximity-landmarks-or-areas-google-place-identifier.md](https://www.gstatic.com/googlemapsplatform-agent-skills/geocoding-api-web-api/references/return-information-about-proximity-landmarks-or-areas-google-place-identifier.md).
    *Dependencies*: `["references/return-address-google-place-identifier.md"]` \
    *Trigger Condition*: Use when the user wants to get nearby landmarks and
    area context (address descriptors) for a Google Place ID. *Evidence
    Checkpoint*: The HTTP geocoding request for a Place ID enables address
    descriptors, and the JSON response includes an address_descriptor object
    with landmarks and areas arrays.
-   [ ] **Retrieves the human-readable formatted address and geographic
    coordinates corresponding to a Google Place ID.** Read
    [references/return-address-google-place-identifier.md](https://www.gstatic.com/googlemapsplatform-agent-skills/geocoding-api-web-api/references/return-address-google-place-identifier.md).
    *Trigger Condition*: Use when the user wants to look up the address or
    geographic details for a known Google Place ID (place_id). *Evidence
    Checkpoint*: The HTTP request includes the place_id parameter and returns a
    200 OK JSON response with the corresponding formatted_address and geometry.
-   [ ] **Retrieves the polygon coordinates representing the 2D building
    footprint outline for a given street address.** Read
    [references/return-latitudelongitude-coordinates-building-outline-address.md](https://www.gstatic.com/googlemapsplatform-agent-skills/geocoding-api-web-api/references/return-latitudelongitude-coordinates-building-outline-address.md).
    *Dependencies*:
    `["references/return-latitudelongitude-coordinates-address-geocoding.md"]` \
    *Trigger Condition*: Use when the user wants to get the building outline or
    polygon footprint coordinates for a physical address. *Evidence Checkpoint*:
    The HTTP geocoding request for an address requests building outlines, and
    the JSON response includes buildings data with building_outlines polygon
    geometry.
-   [ ] **Retrieves the polygon coordinates representing the 2D building
    footprint outline for a set of latitude and longitude coordinates.** Read
    [references/return-latitudelongitude-coordinates-building-outline-set-latitudelongitude-coordinates.md](https://www.gstatic.com/googlemapsplatform-agent-skills/geocoding-api-web-api/references/return-latitudelongitude-coordinates-building-outline-set-latitudelongitude-coordinates.md).
    *Dependencies*:
    `["references/return-address-set-latitudelongitude-coordinates-reverse-geocoding.md"]` \
    *Trigger Condition*: Use when the user wants to get the building outline or
    polygon footprint coordinates for a pair of latitude/longitude coordinates.
    *Evidence Checkpoint*: The HTTP reverse geocoding request requests building
    outlines, and the JSON response includes buildings data with
    building_outlines polygon geometry.
-   [ ] **Retrieves the polygon coordinates representing the 2D building
    footprint outline for a specific Google Place ID.** Read
    [references/return-latitudelongitude-coordinates-building-outline-google-place-identifier.md](https://www.gstatic.com/googlemapsplatform-agent-skills/geocoding-api-web-api/references/return-latitudelongitude-coordinates-building-outline-google-place-identifier.md).
    *Dependencies*: `["references/return-address-google-place-identifier.md"]` \
    *Trigger Condition*: Use when the user wants to get the building outline or
    polygon footprint coordinates for a Google Place ID. *Evidence Checkpoint*:
    The HTTP request for a Place ID requests building outlines, and the JSON
    response includes buildings data with building_outlines polygon geometry.
-   [ ] **Retrieves the latitude and longitude coordinates of building entrances
    for a given street address.** Read
    [references/return-latitudelongitude-coordinates-building-entrance-address.md](https://www.gstatic.com/googlemapsplatform-agent-skills/geocoding-api-web-api/references/return-latitudelongitude-coordinates-building-entrance-address.md).
    *Dependencies*:
    `["references/return-latitudelongitude-coordinates-address-geocoding.md"]` \
    *Trigger Condition*: Use when the user wants to find the exact latitude and
    longitude coordinates of building entrances for a physical address.
    *Evidence Checkpoint*: The HTTP geocoding request for an address requests
    entrance data, and the JSON response includes entrances array with location
    coordinates.
-   [ ] **Retrieves the latitude and longitude coordinates of building entrances
    for a set of latitude and longitude coordinates.** Read
    [references/return-latitudelongitude-coordinates-building-entrance-set-latitudelongitude-coordinates.md](https://www.gstatic.com/googlemapsplatform-agent-skills/geocoding-api-web-api/references/return-latitudelongitude-coordinates-building-entrance-set-latitudelongitude-coordinates.md).
    *Dependencies*:
    `["references/return-address-set-latitudelongitude-coordinates-reverse-geocoding.md"]` \
    *Trigger Condition*: Use when the user wants to find the exact latitude and
    longitude coordinates of building entrances for a pair of latitude/longitude
    coordinates. *Evidence Checkpoint*: The HTTP reverse geocoding request
    requests entrance data, and the JSON response includes entrances array with
    location coordinates.
-   [ ] **Retrieves the latitude and longitude coordinates of building entrances
    for a specific Google Place ID.** Read
    [references/return-latitudelongitude-coordinates-building-entrance-google-place-identifier.md](https://www.gstatic.com/googlemapsplatform-agent-skills/geocoding-api-web-api/references/return-latitudelongitude-coordinates-building-entrance-google-place-identifier.md).
    *Dependencies*: `["references/return-address-google-place-identifier.md"]` \
    *Trigger Condition*: Use when the user wants to find the exact latitude and
    longitude coordinates of building entrances for a Google Place ID. *Evidence
    Checkpoint*: The HTTP request for a Place ID requests entrance data, and the
    JSON response includes entrances array with location coordinates.
