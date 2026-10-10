// Sun position (NOAA general solar position equations) and clear-sky direct-beam irradiance.

const RAD = Math.PI / 180;

/** Solar elevation and azimuth (degrees; azimuth clockwise from north) at local clock time `hour` in time zone `tz` (h, IST = 5.5). */
export function sunPosition(lat: number, lon: number, doy: number, hour: number, tz = 5.5) {
  const g = (2 * Math.PI / 365) * (doy - 1 + (hour - 12) / 24);
  const eqtime = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const tst = hour * 60 + eqtime + 4 * lon - 60 * tz;          // true solar time, minutes
  const ha = (tst / 4 - 180) * RAD;                             // hour angle
  const phi = lat * RAD;
  const cosZ = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.max(-1, Math.min(1, cosZ)));
  const az = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(decl) * Math.cos(phi)) / RAD + 180 + 360) % 360;
  return { elev: 90 - zen / RAD, az };
}

/** Direct normal irradiance, W/m²: Meinel clear-sky beam (1353 × 0.7^(AM^0.678)) reduced linearly by cloud fraction. */
export function directNormal(elevDeg: number, cloud: number) {
  if (elevDeg <= 0.5) return 0;
  const am = 1 / Math.sin(elevDeg * RAD);
  return 1353 * Math.pow(0.7, Math.pow(am, 0.678)) * (1 - Math.max(0, Math.min(1, cloud)));
}

/** NOAA heat index (Rothfusz regression with NWS adjustments), °C. Describes the air in the shade, not a body's heat stress. */
export function heatIndexC(tempC: number, rh: number) {
  const T = tempC * 9 / 5 + 32;
  let hi = 0.5 * (T + 61 + (T - 68) * 1.2 + rh * 0.094);
  if ((hi + T) / 2 >= 80) {
    hi = -42.379 + 2.04901523 * T + 10.14333127 * rh - 0.22475541 * T * rh - 0.00683783 * T * T - 0.05481717 * rh * rh
      + 0.00122874 * T * T * rh + 0.00085282 * T * rh * rh - 0.00000199 * T * T * rh * rh;
    if (rh < 13 && T >= 80 && T <= 112) hi -= ((13 - rh) / 4) * Math.sqrt((17 - Math.abs(T - 95)) / 17);
    if (rh > 85 && T >= 80 && T <= 87) hi += ((rh - 85) / 10) * ((87 - T) / 5);
  }
  return (hi - 32) * 5 / 9;
}

/** NOAA/NWS heat-index caution band. */
export function heatIndexBand(c: number) {
  return c >= 54 ? 'extreme danger' : c >= 41 ? 'danger' : c >= 32 ? 'extreme caution' : c >= 27 ? 'caution' : 'below caution';
}
