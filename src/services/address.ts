import type { LatLngLiteral } from '../types/tour';
import { haversineMeters } from '../utils/geo';

export function simplifyPath(path: LatLngLiteral[], maxPts: number): LatLngLiteral[] {
  if (path.length <= maxPts) return path;
  const step = (path.length - 1) / (maxPts - 1);
  return Array.from({ length: maxPts }, (_, i) => path[Math.round(i * step)]);
}

export function samplePathEquidistant(path: LatLngLiteral[], maxSamples: number, stepMeters = 60): LatLngLiteral[] {
  if (path.length <= 2) return path;
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + haversineMeters(path[i - 1], path[i]));
  const total = cum[cum.length - 1];
  if (total < 10) return [path[0], path[path.length - 1]];

  const count = Math.max(3, Math.min(maxSamples, Math.ceil(total / stepMeters) + 1));
  const samples: LatLngLiteral[] = [];
  for (let s = 0; s < count; s++) {
    const target = (total * s) / (count - 1);
    for (let i = 0; i < path.length - 1; i++) {
      if (target <= cum[i + 1] || i === path.length - 2) {
        const segLen = Math.max(0.001, cum[i + 1] - cum[i]);
        const t = Math.max(0, Math.min(1, (target - cum[i]) / segLen));
        samples.push({
          lat: path[i].lat + t * (path[i + 1].lat - path[i].lat),
          lng: path[i].lng + t * (path[i + 1].lng - path[i].lng),
        });
        break;
      }
    }
  }
  return samples;
}

function transliterateHouseSuffix(input: string): string {
  const map: Record<string, string> = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', к: 'k', м: 'm' };
  return input.replace(/(\d[\d/-]*\s?)([абвгдекм])(?=$|[\s,])/g, (_, num: string, ch: string) => `${num}${map[ch] || ch}`);
}

/** Collapses spelling variants of one street address into the same key, e.g. "7-Б Старовокзальна вулиця" and "7-b ... st". */
export function normalizeStreetKey(address: string): string {
  const parts = address
    .split(',')
    .map((p) =>
      transliterateHouseSuffix(p.trim().toLowerCase())
        .replace(/(?:^|\s)(будинок|буд\.?|bldg\.?|house)(?=$|\s)/gi, ' ')
        .trim()
    )
    .filter(Boolean);
  let targetSegment = parts[0] || '';
  if (parts.length >= 2 && /^\d[\d/-]*(?:\s?[a-zа-я]{1,2})?$/i.test(targetSegment)) {
    targetSegment = `${targetSegment} ${parts[1]}`;
  }

  let streetTypeSuffix = '';
  const extractType = (pattern: RegExp, canonical: string) => {
    if (pattern.test(targetSegment)) {
      if (!streetTypeSuffix) streetTypeSuffix = canonical;
      targetSegment = targetSegment.replace(pattern, ' ');
    }
  };

  targetSegment = targetSegment
    .replace(/тараса\s+шевченка/gi, 'tarasa shevchenka')
    .replace(/шевченка/gi, 'shevchenka')
    .replace(/богдана\s+хмельницького/gi, 'bohdana khmelnytskoho')
    .replace(/володимирська/gi, 'volodymyrska')
    .replace(/саксаганського/gi, 'saksahanskoho')
    .replace(/симона\s+петлюри/gi, 'symona petlyury')
    .replace(/shevchenko/gi, 'shevchenka');

  extractType(/(?:^|\s)(street|st\.?|вулиця|вул\.?)(?=$|\s)/gi, 'st');
  extractType(/(?:^|\s)(avenue|ave\.?|проспект|просп\.?)(?=$|\s)/gi, 'ave');
  extractType(/(?:^|\s)(boulevard|blvd\.?|bulvar|бульвар|б-р)(?=$|\s)/gi, 'blvd');
  extractType(/(?:^|\s)(square|sq\.?|площа|пл\.?)(?=$|\s)/gi, 'sq');
  extractType(/(?:^|\s)(road|rd\.?)(?=$|\s)/gi, 'rd');
  extractType(/(?:^|\s)(drive|dr\.?)(?=$|\s)/gi, 'dr');
  extractType(/(?:^|\s)(lane|ln\.?)(?=$|\s)/gi, 'ln');

  return `${targetSegment}${streetTypeSuffix}`.replace(/[^a-z0-9\u0400-\u04ff]/g, '');
}

/** True only for "<house number> <street>, ..." such as "1 Галицька площа, Kyiv" or "50-52 Volodymyrska Street". */
export function isHouseNumberAddress(streetAddress: string): boolean {
  const first = (streetAddress.split(',')[0] || '').trim();
  return /^\d+(?:[-–/]?\p{L}{0,2})?(?:[-–/]\d+)*\s+\S/u.test(first);
}
