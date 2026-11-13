# Return an Encoded Polyline for a Route (Routes API - Web API)

## Overview

This workflow demonstrates how to compute a route between two or more sets of
latitude and longitude coordinates and retrieve an encoded polyline representing
the route's geometry using the Google Maps Platform Routes API (`computeRoutes`
endpoint).

## Prerequisites

-   **Google Cloud Project** with billing enabled.
-   **Routes API** enabled in the Google Cloud Console.
-   **API Key** restricted to the Routes API.

## Implementation Steps

### 1. Define the Endpoint and Headers

To request a route via REST, send an HTTP `POST` request to the `computeRoutes`
endpoint:

```
https://routes.googleapis.com/directions/v2:computeRoutes
```

Include the following required HTTP headers in your request:

-   `Content-Type: application/json`
-   `X-Goog-Api-Key: YOUR_API_KEY`
-   `X-Goog-FieldMask`: Specify `routes.polyline.encodedPolyline` (along with
    any other desired fields like `routes.duration` or `routes.distanceMeters`).
    The Routes API requires a field mask to determine which fields to calculate
    and return.
-   `X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1`

### 2. Construct the Request Body

Construct a JSON payload containing the `origin` and `destination` (and
optionally `intermediates` for routes between more than two points) formatted as
`latLng` objects. You can also configure options such as `travelMode`,
`routingPreference`, and `polylineQuality`.

#### Example: Two Locations (Origin and Destination)

```bash
curl -X POST -d '{
  "origin": {
    "location": {
      "latLng": {
        "latitude": 37.419734,
        "longitude": -122.0827784
      }
    }
  },
  "destination": {
    "location": {
      "latLng": {
        "latitude": 37.417670,
        "longitude": -122.079595
      }
    }
  },
  "travelMode": "DRIVE",
  "routingPreference": "TRAFFIC_AWARE",
  "computeAlternativeRoutes": false,
  "routeModifiers": {
    "avoidTolls": false,
    "avoidHighways": false,
    "avoidFerries": false
  },
  "languageCode": "en-US",
  "units": "METRIC"
}' \
-H 'Content-Type: application/json' \
-H 'X-Goog-Api-Key: YOUR_API_KEY' \
-H 'X-Goog-FieldMask: routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline' \
-H 'X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1' \
'https://routes.googleapis.com/directions/v2:computeRoutes'
```

#### Example: Multiple Locations (With Intermediate Waypoints)

To compute a route across more than two sets of coordinates, include the
`intermediates` array in the JSON payload:

```bash
curl -X POST -d '{
  "origin": {
    "location": {
      "latLng": {
        "latitude": 37.419734,
        "longitude": -122.0827784
      }
    }
  },
  "intermediates": [
    {
      "location": {
        "latLng": {
          "latitude": 37.418500,
          "longitude": -122.081000
        }
      }
    }
  ],
  "destination": {
    "location": {
      "latLng": {
        "latitude": 37.417670,
        "longitude": -122.079595
      }
    }
  },
  "travelMode": "DRIVE",
  "routingPreference": "TRAFFIC_AWARE"
}' \
-H 'Content-Type: application/json' \
-H 'X-Goog-Api-Key: YOUR_API_KEY' \
-H 'X-Goog-FieldMask: routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline' \
-H 'X-Goog-Maps-Solution-ID: gmp_git_agentskills_v1' \
'https://routes.googleapis.com/directions/v2:computeRoutes'
```

### 3. Parse the Response

The API returns a JSON object containing the `routes` array. Extract the
`encodedPolyline` string from `routes[0].polyline.encodedPolyline`.

```json
{
  "routes": [
    {
      "distanceMeters": 772,
      "duration": "165s",
      "polyline": {
        "encodedPolyline": "ipkcFfichVnP@j@BLoFVwM{E?"
      }
    }
  ]
}
```

## Alternative Implementation: gRPC (Node.js)

If you are using gRPC to call `ComputeRoutes`, pass the API key, FieldMask, and
Solution ID via gRPC metadata:

```javascript
const protoPath = "YOUR_PROTO_PATH";
const grpc = require("@grpc/grpc-js");
const protoLoader = require("@grpc/proto-loader");

const packageDefinition = protoLoader.loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const protoDescriptor =
  grpc.loadPackageDefinition(packageDefinition).google.maps.routing.v2;

const host = "routes.googleapis.com:443";
const apiKey = process.env.GOOGLE_MAPS_API_KEY || "YOUR_API_KEY";
const fieldMask = "routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline";

const computeRoutesRequest = {
  origin: {
    location: {
      lat_lng: {
        latitude: -37.816,
        longitude: 144.964,
      },
    },
  },
  destination: {
    location: {
      lat_lng: {
        latitude: -37.815,
        longitude: 144.966,
      },
    },
  },
  routing_preference: "TRAFFIC_AWARE",
  travel_mode: "DRIVE",
};

const sslCreds = grpc.credentials.createSsl();
const callCreds = grpc.credentials.createFromMetadataGenerator((args, callback) => {
  const metadata = new grpc.Metadata();
  metadata.set("X-Goog-Api-Key", apiKey);
  metadata.set("X-Goog-Fieldmask", fieldMask);
  metadata.set("X-Goog-Maps-Solution-ID", "gmp_git_agentskills_v1");
  metadata.set("Content-Type", "application/json");
  callback(null, metadata);
});

const credentials = grpc.credentials.combineChannelCredentials(sslCreds, callCreds);
const client = new protoDescriptor.Routes(host, credentials);

client.ComputeRoutes(computeRoutesRequest, (error, response) => {
  if (error) {
    console.error("RPC Error:", error);
    return;
  }
  console.log("Encoded Polyline:", response.routes[0]?.polyline?.encoded_polyline);
});
```

## Best Practices & Notes

-   **Field Masking**: Avoid using `*` in `X-Goog-FieldMask` in production
    environments. Explicitly requesting only `routes.polyline.encodedPolyline`
    (and other strictly needed fields) minimizes latency and avoids unnecessary
    billing charges for advanced SKUs.
-   **Polyline Quality**: If you need higher precision or lower payload size,
    you can set `"polylineQuality": "HIGH_QUALITY"` or `"polylineQuality":
    "OVERVIEW"` in the request body.
-   **Leg Polylines**: When routing through `intermediates`, if you need
    separate encoded polylines for each segment (leg) of the journey rather than
    just the overall route, add `routes.legs.polyline.encodedPolyline` to your
    `X-Goog-FieldMask`.
